# CONTEXT_LLM.md — Contexto Maestro de Arquitectura (Vehicle-Inspection-CM)

> **Propósito:** Este archivo es el *system prompt* base para cualquier modelo de IA que continúe el desarrollo. Es la fuente de verdad arquitectónica. Léelo **completo** antes de escribir una sola línea. Si una instrucción del usuario contradice estas reglas, **cuestiónala antes de ejecutar** (el usuario lo exige explícitamente: escalabilidad > velocidad, cero deuda técnica).
>
> **Fecha de corte del documento:** 2026-06-10 · **Commit base:** `d4b4a12` ("9 de junio versión final") · **Tests:** 448 passing / 0 errores TS.
> **Idioma del proyecto:** español (comentarios, mensajes de error, docs de negocio). Mantenlo.

---

## 1. Visión General y Negocio

Sistema de **gestión de flota vehicular multi-país** para controlar el paso de vehículos por las **garitas (gates)** de las sucursales de Grupo ConstruMarket (operación en **PA, GT, SV, NI**). Los **guardias** registran en cada turno el estado de los vehículos que entran/salen (kilometraje, daños, retornos, fotos); el sistema asigna el **turno automáticamente** según la hora local de la sucursal y lleva el control —el guardia no "envía" nada—. **Jefes de operaciones y administradores** supervisan en tiempo real (vehículos sin revisar, daños abiertos, historial), gestionan flota/conductores/usuarios y configuran el sistema por jerarquía de alcance.

Modelo conceptual central: **stream puro de eventos**. Cada inspección **es** un evento autocontenido (no hay sesiones ni reportes que enviar). El estado especial de un vehículo (taller, extranjero, servicio nocturno, autorización especial) **persiste en el vehículo** hasta que alguien lo cambie (acción auditada).

---

## 2. Stack Tecnológico Consolidado

### Backend (`backend/`)
- **Runtime:** Node.js **20** (fijado en `Dockerfile`), TypeScript **5.4.5** (`strict`, target ES2022, módulo CommonJS).
- **Web:** Express **4.19.2**.
- **Datos:** driver **`mssql` 12.5.4 crudo** sobre **SQL Server**. **CERO ORM** (no Prisma/TypeORM/Sequelize/Knex). Todo SQL es parametrizado a mano.
- **Auth:** `jsonwebtoken` **9.0.2** (JWT) + `bcryptjs` (hash cost **12**) + `cookie-parser`.
- **Seguridad HTTP:** `helmet` **7.1.0** (CSP solo en prod, HSTS), `cors` **2.8.5** (origen estricto en prod, `credentials: true`), `express-rate-limit` **7.3.1**.
- **Validación:** `zod` **3.23.8** (schemas de request).
- **Fotos:** `multer` (multipart) + `sharp` (procesamiento de imágenes).
- **Tests:** **Jest 29.7** + **Supertest 7.2.2** (`ts-jest` transpile-only). 14 suites / **448 tests**. DB mockeada; JWT real.
- **Build:** `esbuild` bundle a `dist/server.js` con `--external:mssql --external:sharp` (módulos nativos quedan como deps).

### Frontend (`frontend/`)
- **React 18.3.1** + **Vite 5.3.1** (alias `@` → `./src`, dev server :5173 con proxy `/api`).
- **React Router 7.17.0** (routing por rol post-login).
- **Tailwind CSS 3.4.19** con tokens de marca ConstruMarket (`brand.navy #0b1f38`, `accent #f5a623`, `teal #009879`).
- **shadcn/ui** estilo **`new-york`** (`components.json`). Primitivas en `src/components/ui/`: `button, card, badge, alert, input, tabs`.
- **HTTP:** `axios` (`baseURL: '/api'`, `withCredentials: true`, timeout 30s, interceptor 401 → evento `unauthorized`).
- SPA servida en prod como estáticos por el contenedor app; en dev por Vite.

### Infraestructura (`docker-compose*.yml`, `Dockerfile`, `nginx/`)
- **Docker multi-stage** (`node:20-alpine`, 3 etapas: frontend-builder → backend-builder(esbuild) → runtime no-root `appuser`).
- **Docker Compose** — stack **prod = 2 servicios**: `app` (Node, `expose: 3001`, **no** publicado) + `nginx` **1.27-alpine** (publica :80/:443).
- **Nginx = reverse proxy único**: redirección 80→443 + TLS, sirve `/uploads/*.{jpg,jpeg,png,webp}` directo del volumen (cache 7d, lista denegada con 403), proxya `/api/*` al app (rate-limit propio) y `/` (SPA). `client_max_body_size 22m`.
- **SQL Server:** **externo, no contenerizado** (Azure SQL o `host.docker.internal` en dev). Config por `.env` (`MSSQL_*`).
- **Almacenamiento de archivos:** **volumen Docker local `vi_uploads`** (rw en app, ro en nginx). **Cero BLOBs en DB**: la tabla `Photos` guarda solo `StoragePath`/`InternalUrl`.

---

## 3. Reglas Arquitectónicas Inquebrantables (Non-Negotiables)

> Mandamientos para el próximo LLM. Romper cualquiera de estos es introducir un bug de arquitectura o de seguridad.

1. **Backend-first.** La autoridad de negocio y autorización vive en el backend. El frontend **nunca** es la fuente de verdad de permisos; sus checks de rol son solo para mostrar/ocultar UI. **Toda** regla se valida y enforza en el servidor.

2. **CERO ORM. Solo SQL Server parametrizado.** Escribe consultas con `mssql` crudo y parámetros (`@param`). **Jamás** interpoles valores de usuario en strings SQL. Los **identificadores** (nombres de columna) no se parametrizan: si necesitas inyectar uno, debe venir de la **allowlist** `SCOPE_COLUMNS` en `db/scopeUtils.ts` (4 valores fijos) validada en runtime por `assertScopeColumn`.

3. **`request = transacción atómica`** (modelo RLS). Cada request HTTP corre en **UNA** transacción SQL Server fijada a **una** conexión (`middleware/dbContext.ts`), que sostiene el `SESSION_CONTEXT` para RLS. **Commit si la respuesta es <400; rollback en error o abort del cliente.**
   - Toda operación reusa esa transacción vía `getConn()` (lee `txStorage`, un `AsyncLocalStorage`). **NUNCA** abras conexión/transacción propia.
   - **Prohibido `Promise.all` de queries sobre `getConn()`** — una conexión no multiplexa requests ("connection is busy"). Encadena `await` secuenciales.
   - No refactorizar a split read/write salvo que pruebas de carga muestren saturación del pool (disparador medible, no especulativo). Pool: `max 50, min 2, acquireTimeout 15s`.

4. **Autenticación estricta: JWT en cookie `httpOnly`.** Token en cookie **`vi_token`** (`httpOnly: true`, `secure` y `sameSite:'strict'` en prod, `sameSite:'lax'` en dev). El frontend **nunca** lee el token; manda cookies con `withCredentials: true`. **Prohibido guardar credenciales/JWT en `localStorage`** (vector XSS). *Matiz permitido:* `localStorage` se usa solo para **borradores no sensibles** del formulario de inspección (`InspectionForm.tsx` `DRAFT_KEY`) — eso es UX, no auth.

5. **Almacenamiento de archivos en volumen Docker local, referenciado por URL en la DB.** Cero BLOBs. **GCS está descartado** (ver §6). La abstracción es `services/storage/PhotoStorage.ts` (`put`/`serve`); la impl activa es `localPhotoStorage.ts` (driver por `STORAGE_DRIVER`, default `local`). Las fotos se sirven **tras chequeo de scope** en `photoController.servePhoto` (no son públicas).

6. **Fechas/zonas horarias delegadas a `Countries.Timezone` (IANA).** La fuente de verdad es `Countries.Timezone NVARCHAR(60) NOT NULL` con nombres IANA (`America/Guatemala`, etc.); `Branches` hereda vía FK `CountryId`. **Prohibido** `UtcOffset`/`IsDST` fijos o una tabla `TimezoneConfig`: el runtime (`Intl`) aplica DST solo. Resolver siempre con `getBranchTimezone(branchId)` (cacheado). Granularidad futura por sucursal = `Branches.TimezoneOverride NVARCHAR(60) NULL` con COALESCE, **no** una tabla nueva.

7. **RLS no se puede saltar: el app NO conecta como `db_owner`/`sysadmin`.** SQL Server **ignora silenciosamente** toda la RLS para roles privilegiados. El arranque (`index.ts`) hace un *self-test* (`IS_ROLEMEMBER`/`IS_SRVROLEMEMBER` + conteo de `sys.security_policies` habilitadas) y **aborta FATAL en producción** si el usuario es privilegiado o no hay políticas. El usuario de app (`vi_app`) tiene solo `db_datareader + db_datawriter`.

8. **Auditar toda mutación sensible.** Cambios de settings (`UPDATE_SETTING`/`RESET_SETTING`), ediciones de inspecciones selladas (`UPDATE_AFTER_SEAL`) y cambios de estado de vehículo se registran en `AuditLogs` vía `createAuditLog` (con `oldValue`/`newValue` JSON, `reason`, scope). `AuditLogs` vive **fuera de RLS** y guarda `BranchId`/`CountryId` derivados para filtrar por scope.

9. **Settings = registry declarativo, dos ejes ortogonales.** Agregar un setting = **una entrada** en `utils/settingsRegistry.ts` (cero migración). Eje `writableFrom` (rol mínimo que puede escribir) y `overridableTo` (nivel más bajo donde puede existir un valor). Invariante validado al boot: `rank(writableFrom) >= rank(overridableTo)`. Cascada de lectura: **branch → country → global → default del registry**.

10. **Cuestionar el plan.** Antes de ejecutar, evalúa si la solución es la correcta a largo plazo. Si hay una alternativa más escalable o con menos deuda, propónla con justificación breve; ejecuta tras validación. No te adelantes a fases futuras, pero piensa en sus consecuencias.

---

## 4. Aislamiento de Datos (Multi-tenant Scope: Global → País → Sucursal)

El aislamiento es **doble capa** y la **primaria es la base de datos** (no la app).

### Capa 1 — Row-Level Security en SQL Server (autoritativa)
- **6 tablas protegidas:** `Vehicles`, `Inspections`, `Drivers`, `OpenIssues`, `Photos`, `VehicleStatusLog` (en `database/Operaciones.sql:~659-769`).
- **2 funciones-predicado** que leen `SESSION_CONTEXT` **dentro** de la DB:
  - `Security.fn_BranchFilter(@BranchId)` → fila visible **sii** `CtxIsGlobal = 1` **OR** `CtxBranchId = @BranchId` **OR** el branch pertenece a `CtxCountryId`.
  - `Security.fn_VehicleFilter(@VehicleId)` → navega `VehicleId → Vehicles.BranchId` y aplica la misma lógica (para tablas hijas).
- **Políticas:** `VehiclesPolicy`, `InspectionsPolicy`, `DriversPolicy`, `OpenIssuesPolicy`, `PhotosPolicy`, `VehicleStatusLogPolicy`, cada una con **FILTER PREDICATE** (SELECT) **y BLOCK PREDICATE** (INSERT/UPDATE).
- **Fail-closed:** si el `SESSION_CONTEXT` no está inicializado, los `CAST(NULL AS INT)` hacen que el predicado dé NULL → **no pasa ninguna fila** y los INSERT/UPDATE son rechazados por la DB.

### Propagación del scope por request
1. `middleware/dbContext.ts` abre la transacción y **pone en cero** `CtxBranchId/CtxCountryId/CtxIsGlobal` al inicio (evita fuga de contexto de un request previo en la conexión pooleada). Si el `sp_set_session_context` falla, **aborta el request**.
2. `middleware/auth.ts` (`requireAuth`) verifica el JWT de la cookie y llama `setTenantContext(payload)` (`db/connection.ts:~129-146`), que escribe los 3 valores según el rol:
   - `admin_global` → `CtxIsGlobal = 1` (resto NULL).
   - `admin_pais` → `CtxCountryId = user.countryId`, `CtxBranchId = NULL`.
   - `admin` / `jefe_operaciones` / `guardia` → `CtxBranchId = user.branchId`.
3. `requireValidBranchContext` valida que un `?branchId` solicitado por `admin_pais` pertenezca a su país (si no, `403 BRANCH_OUT_OF_SCOPE`).

### Capa 2 — Guardas a nivel aplicación (defensa en profundidad, sobre todo en writes)
- `assertResourceInScope(resourceBranchId, scope)` (`db/scopeUtils.ts`) — lanza `403 OUTSIDE_SCOPE` antes de UPDATE/DELETE.
- `applyScopeWhere(col)` — inyecta fragmento `WHERE` parametrizado para lecturas que lo requieran; `col` **solo** de la allowlist `SCOPE_COLUMNS`.
- `resolveScope` / `targetScopeFromRequest` / `assertCanAccessScope` (`middleware/tenantScope.ts`) — targeting explícito de scope (`?level=global|country|branch` + `countryId`/`branchId`); sin `level`, scope natural del rol.
- **Patrón anti-IDOR:** los handlers leen el recurso por id sin scope y luego llaman `assertResourceInScope` → mismo `404` para "no existe" y "fuera de scope" (no se filtra existencia).

> **Tablas SIN RLS:** `Users`, `Branches`, `Countries`, `Settings`, `VehicleStatusTypes`, `AuditLogs`. Su aislamiento es por `WHERE` escrito a mano + reglas de rol. Si expones un nuevo endpoint sobre `VehicleStatusLog` u otra tabla hija, **debes** aplicar scope explícito (ver PENDIENTE-02 en §6).

---

## 5. Flujos Críticos Blindados

### 5.1 Máquina de estados: turnos / inspecciones (modelo stream puro — `inspectionController.ts`, `db/inspections.ts`, `db/timezone.ts`)
- **No existen sesiones.** No hay `InspectionSessions`, ni "iniciar/terminar turno", ni "enviar reporte". Cada `Inspection` es un evento autocontenido.
- **Estampado en el INSERT:** `BranchId`, `LocalDate (DATE)`, `Shift` se calculan **en el servidor**. `shiftContext()` resuelve `getBranchTimezone(branchId)` → `getHourInTimezone(instant, tz)` → `resolveShift(hora, settings)` → `'morning'|'afternoon'|'night'`. El cliente **nunca** manda el turno. `getOperationalDate()` ancla el turno nocturno al día en que **empezó** (mata el problema de medianoche).
- **Sellado por cambio de turno (edit-lock):** `isSealed = (LocalDate o Shift de la inspección existente ≠ los actuales)`.
  - Guardia: edita libre **durante su turno**; si está sellada → **rechazo**.
  - Supervisor (roles en `SUPERVISOR_ROLES`): puede editar sellada **solo con `modificationReason`**; se persiste `ModifiedAfterSeal=1` + `ModifiedById` + `ModifiedReason` y se llama `logSealEdit()` → `AuditLogs` acción **`UPDATE_AFTER_SEAL`** con snapshot JSON. Este es el "enviar" automático.
- **`ReturnStatus` (evento puntual del turno)** — dominio cerrado por CHECK SQL: **`received` | `not_returned` | `never_left` | `other`**. (No existe `absent`.)
  - `received` + `mileage` → si el vehículo no estaba `active`, `setVehicleStatus('active')` (lo "reactiva" al reaparecer).
  - `never_left` → excluye al vehículo del **monitor de "sin revisar"** ese día (es un FILTER, no un lock).
- **`special_authorization` NO es un `ReturnStatus`** — es un **estado persistente** del vehículo (`VehicleStatusTypes`, tipo de sistema). No lo confundas.
- **Control de completitud = monitor suave, no barrera.** Query derivada "vehículos `active` sin inspección en N horas" (`getUnseenVehicles`) para el supervisor. **Nunca** bloquea al guardia.
- **Kilometraje = advertencia suave** (`services/mileageService.ts`): warning si `< previo` o `diferencia > umbral` (setting por branch). **No es un gate**; es confirm-dialog.

### 5.2 Estado persistente del vehículo (`Vehicles.CurrentStatus`)
- `CurrentStatus NVARCHAR(50) NOT NULL DEFAULT 'active'` con **FK a `VehicleStatusTypes([Key])`** (dominio cerrado). Tipos de sistema (no eliminables): `active`, `workshop`, `night_service`, `abroad`, `special_authorization`. Tipos custom por país.
- Se cambia vía `setVehicleStatus()` → escribe en `VehicleStatusLog` (auditado). El "ausente" del negocio se modela con estos estados persistentes, **no** con un `ReturnStatus`.

### 5.3 Autenticación y jerarquía de roles
- **Jerarquía (`utils/roleCapabilities.ts` = fuente de verdad):** `guardia(1) < jefe_operaciones(2) < admin(3) < admin_pais(4) < admin_global(5)`.
- **Login:** PIN (guardia) y password (admin) comparten el campo `passwordHash` (bcrypt-12); la UI fuerza formato. Rechaza inactivos (`401`) y mala config de scope (`403 USER_MISCONFIGURED`). Rate-limit login: **8 intentos fallidos / 15 min** (`skipSuccessfulRequests`).
- **Matrices canónicas:** `ASSIGNABLE` (a quién puedes crear) y `MANAGEABLE` (a quién puedes editar/desactivar).
  - **Peer-management:** puedes **crear** un par de tu nivel, pero **no editar/desactivar** a un par (requiere el nivel inmediato superior).
  - **Auto-edición prohibida:** ningún usuario edita su propio perfil (`SELF_EDIT_FORBIDDEN` en `routes/admin.ts`).
  - Solo `admin_global` gestiona `admin_pais`/`admin_global` y crea/edita países.
- **Guardas de ruta:** `requireAuth` → `requireRole(...roles)` → `requireValidBranchContext` (donde aplica).
- **Frontend:** `AuthContext` carga el usuario con `GET /auth/me` al montar (cookie `httpOnly`, sin `localStorage`); routing por rol: `guardia → /guard` (Dashboard), resto → `/ops` (OpsShell). Los flags de capacidad en frontend son **solo UI**.

---

## 6. Cementerio de Deuda Técnica (No tocar / No confundir)

> ⚠️ **Corrección importante para el próximo LLM:** la premisa de que sobreviven "prefijos de SharePoint" y "dialectos OData" en la capa de datos es **FALSA a hoy**. Un grep exhaustivo del repo (excluyendo `node_modules`) por `SharePoint|odata|$filter|$select` devuelve **cero** ocurrencias en código fuente. La migración v1 (OData/SharePoint) → v3 (event-stream) fue **limpia**. No busques ni preserves ese legacy: **ya no existe**.

Lo que **sí** es residuo real y debes **ignorar / no extender**:

- **`backend/src/services/storage/gcsPhotoStorage.ts`** — **stub muerto**. GCS fue **descartado**. Sus métodos `put`/`serve` **lanzan "not implemented"**. Es alcanzable por el factory si `STORAGE_DRIVER=gcs`, pero **crashea en runtime**. **No lo cablees ni lo completes** salvo decisión explícita de negocio; el almacenamiento es volumen local.
- **`database/Operaciones.sql:7-9`** — comentario de changelog que menciona la eliminación de `InspectionSessions`. Es **documentación histórica**, no código vivo. No recrees esa tabla.
- **`deploy/DEPLOYMENT.md`** — contiene referencias **obsoletas a SQLite** (`/app/data/*.db`) y ejemplos de backup que **no aplican**: el stack real es **SQL Server**. Trátalo como parcialmente desactualizado (probable copy-paste de otro proyecto).
- **`STORAGE_DRIVER` sin validación** — un valor desconocido cae silenciosamente a `local`. No es un bug activo, pero no confíes en él para detectar typos.
- **`frontend/src/lib/roleCapabilities.ts`** — **réplica manual** de `backend/src/utils/roleCapabilities.ts` (lo dice su comentario línea 3). **No hay mecanismo de sync.** Si cambias la matriz de roles en backend, debes actualizar **a mano** este archivo **y** los flags de `AuthContext.tsx`. Riesgo de divergencia conocido.
- **`INVALID_SHIFT_ORDER`** (`db/settings.ts`) usa el patrón viejo `Object.assign(new Error, {statusCode})` en vez de `AppError`. Inconsistente pero funcional; migrar a `AppError` si lo tocas.
- **Limitaciones aceptadas (no son bugs a "arreglar" sin pedido):** rate-limiter **en memoria** (se resetea al reiniciar, no sirve en cluster); logout **no revoca** el JWT (expira por TTL, default 12h); cache de timezone (`tzCache`) **no se invalida** salvo edición de país.

**PENDIENTES documentados en `backend/src/__tests__/AUDIT.md` (baja severidad, no bloquean prod):**
- **PENDIENTE-01:** `GET /vehicles/:id/history` responde `200 []` fuera de scope (vs `404` de `/vehicles/:id`) → leve fuga de existencia.
- **PENDIENTE-02:** lecturas de `VehicleStatusLog` **sin scope** — mitigado solo por ausencia de endpoint público. Si expones uno, **aplica scope vía join a Vehicles**.
- **PENDIENTE-03:** allowlist de columnas de scope (diseño correcto, sin riesgo activo).
- **PENDIENTE-04:** `initialMileage` sin bounds-check (decisión de diseño).
- **PENDIENTE-05:** cache de timezone nunca invalidado (aceptado).

---

## 7. Estado Actual (Checkpoint)

### Lo último que se hizo
- **Commit `d4b4a12` ("9 de junio versión final")** — **working tree limpio**. Fase de **hardening de seguridad + cobertura de tests** del backend.
- Se agregaron **448 tests** (Jest+Supertest, 14 suites, DB mockeada, JWT real, ~11s) y `AUDIT.md` (658 líneas).
- **8 bugs corregidos** (ver `backend/src/__tests__/AUDIT.md`):
  - **BUG-01 / BUG-02 (IDOR):** `getVehicleById(id, scope?)` y `getOpenIssuesByVehicle(vehicleId, scope?)` ahora filtran por scope (404 fuera de alcance, sin enumeración).
  - **BUG-03/04/05 (500→404):** `getVehicleById`/`getCountryById`/`getBranchById` lanzan `AppError(404)` en vez de `Error` genérico.
  - **BUG-06 (type injection):** `photoType` validado contra enum cerrado (`400 INVALID_PHOTO_TYPE`).
  - **BUG-07 (timezone):** `POST/PUT /countries` validan IANA con `Intl.DateTimeFormat` (`400 INVALID_TIMEZONE`) — evita que un timezone basura bloquee todas las inspecciones de un país.
- Esquema DB en **`Operaciones.sql` v3.0**: columnas de actor normalizadas a `INT` con FK a `Users`; `Vehicles.CurrentStatus` con FK a `VehicleStatusTypes`; políticas RLS sobre 6 tablas; índice `UX_Inspections_Bucket` (1 entry + 1 exit por vehículo/fecha/turno).
- **Settings UI ya existe** (`frontend/src/pages/ops/SettingsPage.tsx` + `ScopeBar`, `SettingRow`, `ShiftTimesEditor`, `SourceBadge`) — usa `canEdit`/`source`/`overridableTo` de `getSettingsWithMeta`.

### Siguiente paso lógico
1. **Despliegue / CI-CD** según `DEPLOY_PROPOSAL.md`: pipeline (Azure Pipelines) → ACR → Docker Compose en servidor; **sistema de migraciones** (`schema_migrations` + `.sql` numerados en `database/migrations/`) que aún **no está implementado** (hoy el schema se aplica con `Operaciones.sql` + `create-app-user.sql` idempotentes, en ese orden).
2. **Cablear el ingreso público real** (Cloudflare Tunnel frente a nginx) — definirlo formalmente en el stack de despliegue.
3. **Verificación en entorno productivo** con `VERIFICACION_AUDITORIA.md` (self-test de RLS, atomicidad de transacción, regresión de los 8 bugs).
4. Cerrar PENDIENTE-01/02 si se exponen endpoints de historial/`VehicleStatusLog`.

---

## Apéndice — Mapa de archivos clave (`backend/src/`)

```
config/app.ts          Cadena de middleware (orden EXACTO): trust proxy → helmet → cors →
                       cookieParser → json/urlencoded(1mb) → globalLimiter(200/15m) →
                       loginLimiter(8/15m) → health → dbContextMiddleware → rutas → errorHandler
index.ts               Boot: valida env (JWT_SECRET ≥32, MSSQL_*), conecta DB, self-test RLS (FATAL en prod)
middleware/
  dbContext.ts         Transacción por request + zero-out SESSION_CONTEXT + commit<400/rollback
  auth.ts              requireAuth (verifica cookie vi_token) → setTenantContext
  roles.ts             requireRole(...roles)
  tenantScope.ts       resolveScope / targetScopeFromRequest / assertCanAccessScope
  requireValidBranchContext.ts
db/
  connection.ts        Pool (max 50), getConn() sobre txStorage, setTenantContext
  scopeUtils.ts        SCOPE_COLUMNS (allowlist), applyScopeWhere, assertResourceInScope
  inspections.ts       Stream model: INSERT con BranchId/LocalDate/Shift, upsert resiliente a carrera
  timezone.ts          resolveShift, getHourInTimezone, getOperationalDate (puras)
  vehicles.ts          getVehicleById(scope?), setVehicleStatus → VehicleStatusLog
  settings.ts          Cascada branch→country→global→default, getTypedSettings, getSettingsWithMeta
  audit.ts             createAuditLog
  branches.ts          getBranchTimezone (cache IANA)
controllers/           auth, inspection, openIssue, photo, settings, vehicleStatus, vehicleStatusType
utils/
  roleCapabilities.ts  ROLE_RANK + ASSIGNABLE + MANAGEABLE (fuente de verdad de permisos)
  settingsRegistry.ts  Registry declarativo (writableFrom/overridableTo), invariante al boot
services/
  mileageService.ts    Validación suave de kilometraje
  exportService.ts     Export a Excel de reportes
  photoService.ts      buildPhotoKey (yyyy/mm/dd/placa/...), storePhoto
  storage/             PhotoStorage(if) + localPhotoStorage(activo) + gcsPhotoStorage(STUB muerto)
database/
  Operaciones.sql      Schema v3.0 + funciones-predicado + 6 políticas RLS
  create-app-user.sql  Login vi_app (db_datareader + db_datawriter, NO db_owner)
```

> Documentos de negocio/verificación: `MANUAL_PROCESOS_NEGOCIO.md` (negocio, roles, modelo de turnos), `backend/src/__tests__/AUDIT.md` (8 bugs + 5 pendientes), `VERIFICACION_AUDITORIA.md` (checklist prod), `DEPLOY_PROPOSAL.md` (CI/CD objetivo).
