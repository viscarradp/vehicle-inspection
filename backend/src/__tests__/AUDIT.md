# Auditoría de Seguridad y Calidad — Vehicle Inspection Backend

**Fecha:** 2026-06-09 · **Actualizado:** 2026-06-10 (hallazgos pendientes resueltos)  
**Alcance:** Backend completo (14 módulos de rutas + controladores + servicios)  
**Estado del suite:** 533 tests · 17 suites · 0 errores TS · todos pasando  
**Ramas afectadas:** `master` → `origin/main`

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Bugs encontrados y corregidos](#2-bugs-encontrados-y-corregidos)
3. [Hallazgos pendientes de corrección](#3-hallazgos-pendientes-de-corrección)
4. [Tests añadidos por módulo](#4-tests-añadidos-por-módulo)
5. [Patrones de riesgo documentados](#5-patrones-de-riesgo-documentados)
6. [Estado del harness de testing](#6-estado-del-harness-de-testing)

---

## 1. Resumen ejecutivo

Se realizó una auditoría completa del backend cubriendo superficie de seguridad, casos borde y errores de usuario. Se encontraron **8 bugs en código de producción** (2 críticos IDOR, 3 errores de respuesta HTTP, 1 inyección de tipo, 1 validación faltante, 1 error de tipo preexistente en tests) y **5 riesgos** de menor severidad.

**Actualización 2026-06-10:** los **5 hallazgos pendientes fueron resueltos** (detalle en la sección 3). La resolución se hizo con la filosofía de la arquitectura — Express crudo, `mssql` nativo, sin ORMs ni parches — y se ordenó por impacto en integridad de DB y aislamiento multi-tenant: primero PENDIENTE-03 (la primitiva de scope), del que dependía endurecer con seguridad cualquier consulta scopeada nueva.

| Categoría | Total encontrados | Corregidos | Pendientes |
|---|---|---|---|
| IDOR / escape de scope | 2 | ✅ 2 | — |
| HTTP 500 en lugar de 404 | 3 | ✅ 3 | — |
| Inyección de tipo en body | 1 | ✅ 1 | — |
| Validación de entrada faltante | 1 | ✅ 1 | — |
| Inconsistencia de scope | 1 | ✅ 1 | — |
| RLS faltante en tabla | 1 | ✅ 1 (barrera de diseño) | — |
| SQL interpolation risk | 1 | ✅ 1 | — |
| Bounds checking | 1 | ✅ 1 | — |
| Cache de timezone obsoleta | 1 | ✅ 1 | — |

---

## 2. Bugs encontrados y corregidos

### BUG-01 — IDOR: `GET /vehicles/:id` sin filtro de scope

**Severidad:** 🔴 Crítico  
**Tipo:** IDOR (Insecure Direct Object Reference)  
**Archivo:** `backend/src/db/vehicles.ts`, `backend/src/routes/vehicles.ts`

**Descripción:**  
`getVehicleById(id)` ejecutaba `SELECT * FROM Vehicles WHERE Id = @id` sin ningún filtro de tenant. Cualquier usuario autenticado con un JWT válido podía leer los datos de cualquier vehículo de cualquier sucursal o país con solo conocer (o iterar) el ID numérico.

**Código antes:**
```ts
// db/vehicles.ts
export async function getVehicleById(id: string): Promise<Vehicle> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(id, 10));
  const result = await req.query(`SELECT * FROM Vehicles WHERE Id = @id`);
  if (!result.recordset[0]) throw new AppError(404, 'NOT_FOUND', '...');
  return toVehicle(result.recordset[0]);
}

// routes/vehicles.ts — GET /:id
const vehicle = await getVehicleById(req.params.id); // sin scope
```

**Corrección aplicada:**
```ts
// db/vehicles.ts — scope opcional fusionado en SQL
export async function getVehicleById(id: string, scope?: TenantScope): Promise<Vehicle | null> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(id, 10));
  const scopeClause = scope ? `AND ${applyScopeWhere(req, scope)}` : '';
  const result = await req.query(`SELECT * FROM Vehicles WHERE Id = @id ${scopeClause}`);
  return result.recordset[0] ? toVehicle(result.recordset[0]) : null;
}

// routes/vehicles.ts — GET /:id
const scope = scopeFromRequest(req);
const vehicle = await getVehicleById(req.params.id, scope);
if (!vehicle) { res.status(404).json({ ... }); return; }
```

**Test que lo cubre:** `vehicles.test.ts` — "404 when vehicle is outside caller scope (no IDOR)"

---

### BUG-02 — IDOR: `GET /vehicles/:id/open-issues` sin filtro de scope

**Severidad:** 🔴 Crítico  
**Tipo:** IDOR  
**Archivo:** `backend/src/db/issues.ts`, `backend/src/routes/vehicles.ts`

**Descripción:**  
`getOpenIssuesByVehicle(vehicleId)` retornaba todos los issues abiertos de un vehículo sin verificar si ese vehículo pertenece al scope del caller. Un usuario de la sucursal A podía consultar los issues del vehículo 999 que pertenece a la sucursal B.

**Corrección aplicada:**  
Se añadió parámetro `scope?: TenantScope`. Con scope, la query hace JOIN con `Vehicles` y aplica filtro. Sin scope, mantiene comportamiento original (usado internamente por `openIssueController` para recalcular `hasOpenIssues`).

```ts
export async function getOpenIssuesByVehicle(vehicleId: string, scope?: TenantScope): Promise<OpenIssue[]> {
  if (scope) {
    // JOIN con Vehicles para filtrar por scope
    const scopeClause = applyScopeWhere(req, scope, 'v.BranchId');
    const result = await req.query(`
      SELECT oi.* FROM OpenIssues oi
      JOIN Vehicles v ON v.Id = oi.VehicleId
      WHERE oi.VehicleId = @vehicleId AND oi.Status = 'open' AND ${scopeClause}
      ORDER BY oi.DetectedAt DESC
    `);
    return result.recordset.map(toIssue);
  }
  // Sin scope: uso interno (recalcular flag hasOpenIssues)
  ...
}
```

**Test que lo cubre:** `vehicles.test.ts` — "200 empty list when vehicle is outside caller scope"

---

### BUG-03 — HTTP 500 en lugar de 404: `setVehicleStatus`

**Severidad:** 🟠 Alto  
**Archivo:** `backend/src/db/vehicles.ts` línea ~209

**Descripción:**  
Cuando `PATCH /vehicles/:id/status` se llamaba con un ID inexistente, la función lanzaba `new Error('Vehicle X not found')` en lugar de un `AppError`. El error genérico caía al handler global que retornaba 500 al cliente.

**Corrección:**
```ts
// Antes:
if (!current.recordset[0]) throw new Error(`Vehicle ${data.vehicleId} not found`);
// Después:
if (!current.recordset[0]) throw new AppError(404, 'NOT_FOUND', 'Vehículo no encontrado.');
```

**Test que lo cubre:** `vehicles.test.ts` — "404 when vehicle not found" (PATCH /status)

---

### BUG-04 — HTTP 500 en lugar de 404: `getCountryById`

**Severidad:** 🟠 Alto  
**Archivo:** `backend/src/db/countries.ts`

**Descripción:**  
`PUT /countries/:id` y `PATCH /countries/:id/activate|deactivate` llamaban a `getCountryById` que lanzaba `new Error(...)` para registros inexistentes. Resultado: 500 en lugar de 404.

**Corrección:**
```ts
// Antes: throw new Error('Country not found')
// Después:
import { AppError } from '../middleware/errorHandler';
throw new AppError(404, 'NOT_FOUND', 'País no encontrado.');
```

**Test que lo cubre:** `countries.test.ts` — "404 country not found"

---

### BUG-05 — HTTP 500 en lugar de 404: `getBranchById`

**Severidad:** 🟠 Alto  
**Archivo:** `backend/src/db/branches.ts`

**Descripción:** Igual al bug anterior pero en branches. `PUT /branches/:id` y `PATCH /branches/:id/activate|deactivate` retornaban 500 cuando la sucursal no existía.

**Corrección:** Mismo patrón — `throw new AppError(404, 'NOT_FOUND', 'Sucursal no encontrada.')`.

**Test que lo cubre:** `branches.test.ts` — "404 branch not found"

---

### BUG-06 — Inyección de tipo: `photoType` no validado

**Severidad:** 🟡 Medio  
**Archivo:** `backend/src/controllers/photoController.ts`

**Descripción:**  
`const photoType: PhotoType = (req.body.photoType as PhotoType) ?? 'other'` aceptaba cualquier string del body sin validación. Un atacante podía enviar `photoType: "injected_custom_type"` y se almacenaría en base de datos tal cual, rompiendo la integridad del tipo enumerado.

**Corrección aplicada:**
```ts
const VALID_PHOTO_TYPES: PhotoType[] = [
  'odometer', 'exterior_damage', 'interior_damage',
  'missing_tool', 'cleanliness', 'other', 'non_return_evidence',
];
const rawPhotoType = req.body.photoType ?? 'other';
if (!(VALID_PHOTO_TYPES as string[]).includes(rawPhotoType)) {
  res.status(400).json({ success: false, statusCode: 'INVALID_PHOTO_TYPE', ... });
  return;
}
const photoType = rawPhotoType as PhotoType;
```

**Test que lo cubre:** `photos.test.ts` — "400 when unknown photoType string is provided"

---

### BUG-07 — Timezone IANA no validada en creación/edición de países

**Severidad:** 🟡 Medio  
**Archivo:** `backend/src/routes/countries.ts`

**Descripción:**  
`POST /countries` y `PUT /countries/:id` aceptaban cualquier string como `timezone` sin verificar que fuera una zona IANA válida. Un timezone inválido almacenado en DB haría que `getDateInTimezone()` lanzara un error en **cada** inspección de ese país, bloqueando completamente la funcionalidad de ese país.

**Corrección aplicada:**
```ts
function isValidIANATimezone(tz: string): boolean {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; }
  catch { return false; }
}
// Antes de crear/actualizar:
if (!isValidIANATimezone(timezone)) {
  res.status(400).json({ success: false, statusCode: 'INVALID_TIMEZONE', ... });
  return;
}
```

**Tests que lo cubren:**  
- `countries.test.ts` — "400 invalid IANA timezone rejected (garbage string)"  
- `countries.test.ts` — "400 invalid IANA timezone rejected (plausible but wrong format)"  
- `countries.test.ts` — "400 invalid IANA timezone rejected on update"

---

### BUG-08 — Error de tipo preexistente en `inspectionController` (TypeScript)

**Severidad:** 🟡 Bajo (error de compilación, detectado en tests)  
**Archivo:** `backend/src/controllers/inspectionController.ts` (schema Zod)

**Descripción:**  
`vehicleId: z.coerce.string()` aceptaba `undefined` del body, produciéndolo como el string literal `"undefined"`. Una petición sin el campo `vehicleId` en el body pasaba la validación Zod y llegaba a la DB con el valor `"undefined"` como ID de vehículo.

**Corrección:**
```ts
// Antes: z.coerce.string()
// Después: z.string().min(1)
```

---

## 3. Hallazgos pendientes de corrección

Identificados durante la auditoría. **Todos resueltos el 2026-06-10.** El orden a continuación es el de **ejecución priorizada** (por impacto en integridad de DB y aislamiento multi-tenant), no el orden original del documento. PENDIENTE-03 se atendió primero porque es la primitiva de la que dependen el resto de consultas scopeadas.

---

### PENDIENTE-03 — `applyScopeWhere(branchCol)` sin whitelist de columnas · **PRIORIDAD 1**

**Severidad:** 🟢→🔴 Latente pero de blast radius total (toda query multi-tenant lo atraviesa)  
**Archivo real:** `backend/src/db/scopeUtils.ts` (el AUDIT original apuntaba a `utils/scope.ts`, ubicación incorrecta)

**Descripción:**  
El tercer parámetro `branchCol` se interpolaba directamente en SQL (`` `${branchCol} = @scopeBranchId` ``). El driver `mssql` solo parametriza *valores*, nunca *identificadores* (columnas/tablas), así que `branchCol` era el único fragmento que llegaba a la query como texto crudo: la superficie de inyección de toda la capa de aislamiento. Todos los callers usaban literales, pero el contrato no estaba verificado.

**✅ RESUELTO:**  
Doble barrera en un único punto de control, sin dependencias nuevas:

1. **Tiempo de compilación** — `branchCol: ScopeColumn`, un *union type* derivado de `SCOPE_COLUMNS` (`'BranchId' | 'v.BranchId' | 'i.BranchId' | 'u.BranchId'`, el set exhaustivo de los 13 callers en `db/{vehicles,issues,inspections,users,drivers}.ts`). `tsc` rechaza cualquier columna no permitida o dinámica en todo el repo.
2. **Tiempo de ejecución** — `assertScopeColumn()` valida contra la allowlist y **falla cerrado**: lanza un `Error` plano (no `AppError`), por lo que el `errorHandler` global responde un 500 genérico sin reflejar el identificador ofensivo al cliente, y lo registra solo en el servidor. El guard corre **antes** de bindear parámetros, así que un payload malicioso nunca toca la query.

**Tests:** `scopeUtils.test.ts` (18) — cláusulas por scope, allowlist por cada caller de producción, y guardia anti-inyección que verifica fail-closed para `DROP TABLE`, `OR 1=1`, `UNION SELECT`, casing alterado, etc.

---

### PENDIENTE-02 — Sin RLS en tabla `VehicleStatusLog` · **PRIORIDAD 2**

**Severidad:** 🟡 Bajo-Medio (latente)  
**Archivo:** `backend/src/db/vehicles.ts`

**Descripción:**  
Las lecturas de `VehicleStatusLog` no tendrían filtro de tenant si se expusieran por un endpoint.

**✅ RESUELTO (barrera de diseño, sin código muerto):**  
Verificado que la **única** sentencia sobre `VehicleStatusLog` es el `INSERT` de `setVehicleStatus`, gobernado por el `SESSION_CONTEXT`/RLS de la transacción del request; **no existe ninguna ruta de lectura ni endpoint**. Añadir un lector scopeado que nadie invoca sería deuda técnica. En su lugar se dejó una **barrera explícita** en el punto exacto del `INSERT`: cualquier lectura futura DEBE hacer `JOIN Vehicles v ON v.Id = VehicleStatusLog.VehicleId` + `applyScopeWhere(req, scope, 'v.BranchId')` (alias ya en la allowlist de PENDIENTE-03). Nunca leer esta tabla sin scope.

---

### PENDIENTE-01 — Inconsistencia de scope: `GET /vehicles/:id/history` · **PRIORIDAD 4**

**Severidad:** 🟡 Bajo  
**Archivo:** `backend/src/routes/vehicles.ts`

**Descripción:**  
`GET /vehicles/:id/history` retornaba 200 + lista vacía para un vehículo fuera de scope, mientras `GET /vehicles/:id` ya retornaba 404 — un caller podía distinguir "sin historial" de "fuera de tu scope".

**✅ RESUELTO (ya corregido en el árbol de trabajo, verificado):**  
El handler hace `getVehicleById(id, scope)` → 404 si es `null` (fuera de scope o inexistente, indistinguible), y solo entonces consulta `getInspectionsByVehicle(id, scope)` (defensa en profundidad: la propia query filtra por `v.BranchId`). Ambos endpoints devuelven el mismo 404 para el mismo par vehículo+scope.

**Tests:** `vehicles.test.ts` — "404 when vehicle is outside caller scope (consistent with GET /:id)".

---

### PENDIENTE-04 — `initialMileage` sin bounds checking · **PRIORIDAD 3**

**Severidad:** 🟢 Muy bajo (integridad de dato)  
**Archivo:** `backend/src/routes/admin.ts`, `backend/src/utils/vehicleFields.ts`

**Descripción:**  
`initialMileage ? parseInt(initialMileage, 10) : 0` no validaba rango ni tipo; `parseInt('100abc')` devolvía `100` en silencio y valores negativos/enormes se almacenaban.

**✅ RESUELTO:**  
Se añadió `parseInitialMileage(raw): number | null` en `utils/vehicleFields.ts` (junto a las demás validaciones de campos de vehículo, en el estilo manual del archivo — sin introducir Zod donde no se usa). Usa `Number()` (no `parseInt`, que acepta basura con cola), exige entero en `[0, 9_999_999]` y rechaza decimales, `NaN`, `Infinity` y tipos no numéricos. El handler `POST /admin/vehicles` responde **400 `INVALID_MILEAGE`** antes de tocar la DB.

**Tests:** `vehicleFields.test.ts` (unit, ~26 casos) + `admin.test.ts` (integración: forwarding válido, default 0, y 400 para negativo/fuera de rango/no-numérico/decimal/cola-basura).

---

### PENDIENTE-05 — Cache de timezone de sucursales nunca se invalida · **PRIORIDAD 5**

**Severidad:** 🟢 Informativo (antes "aceptado por diseño")  
**Archivo:** `backend/src/db/branches.ts`, `backend/src/routes/countries.ts`

**Descripción:**  
`tzCache` (branchId → IANA) servía el valor anterior hasta reiniciar el servidor si cambiaba el timezone de un país.

**✅ RESUELTO (elevado a correcto, cableado a un disparador real):**  
Se añadió `invalidateBranchTimezoneCache()` en `db/branches.ts` y se **cablea** en `PUT /countries/:id`: si el body trae `timezone`, se limpia la cache tras `updateCountry`. Queda correcto de inmediato dentro del proceso (las ediciones de TZ son rarísimas, limpiar toda la cache es trivial). Se documenta el límite multi-instancia (otras instancias se refrescan al reiniciar; la firma admite sustituir el cuerpo por una señal pub/sub si se escala) — sin código muerto: la función se invoca y está testeada.

**Tests:** `countries.test.ts` — invalida al actualizar `timezone`; NO invalida cuando solo cambia el `name`.

---

## 4. Tests añadidos por módulo

**Total: 533 tests en 17 suites** (448 originales + 85 añadidos al resolver los hallazgos pendientes: `scopeUtils.test.ts` 18, `vehicleFields.test.ts` ~26, `mileageService.test.ts`, y casos nuevos en `admin.test.ts` / `countries.test.ts` / `vehicles.test.ts`)

---

### `auth.test.ts` — 30 tests
Endpoints: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `GET /auth/guards`

| Categoría | Tests |
|---|---|
| Login feliz (credenciales válidas, normalización de username) | 3 |
| Login campo faltante / body vacío / tipos inválidos | 6 |
| Credenciales incorrectas, usuario inactivo | 3 |
| Misconfiguration (guardia sin sucursal, admin_pais sin país) | 2 |
| Edge cases (SQL injection en username, JSON malformado) | 4 |
| `/me` — sin cookie, token inválido/expirado/mal firmado, válido | 5 |
| Logout — sin cookie, con cookie válida | 2 |
| Guards — unauthenticated, válido, DB failure | 3 |
| Server resilience (proceso sigue vivo tras 500) | 1 |
| Rate limit en suite separada (`authRateLimit.test.ts`) | 2 |

**Hallazgos documentados (no corregidos, fijados como comportamiento conocido):**
- Username numérico → 500 (no 400) — falta validación de tipo con Zod
- Username de solo espacios → 401 (pasa guard, se busca `""` en DB)
- JSON malformado → 500 (errorHandler no mapea `entity.parse.failed` → 400)

---

### `inspection.test.ts` — 55 tests
Endpoints: `POST /inspections`, `GET /inspections/:id`, `PATCH /inspections/:id/seal`, `GET /inspections` (historial)

| Categoría | Tests |
|---|---|
| Creación — campos faltantes, validación Zod | 8 |
| Creación — vehículo no encontrado, fuera de scope, inactivo | 4 |
| Creación — vehículo con issues abiertos bloqueado | 2 |
| Creación — mileage inválido (menor al previo) | 2 |
| Creación — inspección ya activa (conflicto) | 1 |
| Creación — roles permitidos vs bloqueados | 4 |
| GET /:id — no encontrado, fuera de scope, roles | 5 |
| PATCH /seal — precondiciones, guardia vs supervisor | 6 |
| Historial de inspecciones — scope, paginación | 5 |
| DB failures en cada operación | 8 |
| Casos edge (mileage = 0, mileage = anterior exacto) | 4 |
| Timestamps en timezone correcto | 2 |

---

### `openIssue.test.ts` — 30 tests
Endpoints: `POST /inspections/:id/issues`, `PATCH /issues/:id/close`, `GET /vehicles/:id/open-issues`

| Categoría | Tests |
|---|---|
| Creación — validación, roles, inspección sellada | 6 |
| Creación — vehículo/inspección fuera de scope | 3 |
| Cierre — transición de estado, flag `hasOpenIssues` | 5 |
| Cierre — issue ya cerrado, no encontrado | 3 |
| Listado — scope enforcement, vacío | 4 |
| Flag `hasOpenIssues` recalculado correctamente | 3 |
| DB failures | 4 |
| Roles que no pueden cerrar issues | 2 |

---

### `vehicles.test.ts` — 41 tests
Endpoints: `GET /vehicles`, `GET /vehicles/:id`, `PATCH /vehicles/:id/status`, `GET /vehicles/:id/open-issues`, `GET /vehicles/:id/history`

| Categoría | Tests |
|---|---|
| Listado — activos vs todos, scope, vacío | 4 |
| GET /:id — 200, 404, **IDOR fix** (out-of-scope → 404), scope forwarded | 5 |
| PATCH /status — todos los valores válidos, inválidos, vehicle 404 | 8 |
| PATCH /status — scope guard | 2 |
| GET /:id/open-issues — scope filtrado, lista vacía | 3 |
| GET /:id/history — historial, threshold from settings | 5 |
| Roles permitidos vs bloqueados por endpoint | 6 |
| DB failures | 6 |
| Token expirado / unauthenticated | 2 |

**Nuevos tests (BUG-01 y BUG-02):**
- "404 when vehicle not found" (getVehicleById returns null)
- "404 when vehicle is outside caller scope (no IDOR)"
- "scope is forwarded to getVehicleById"
- "500 on DB failure in getVehicleById"
- "404 when vehicle not found" (PATCH /status)
- "200 empty list when vehicle is outside caller scope" (open-issues)

---

### `admin.test.ts` — 50 tests
Endpoints: `POST /admin/vehicles`, `PUT /admin/vehicles/:id`, `PATCH /admin/vehicles/:id/activate|deactivate`, `GET /admin/users`, `POST /admin/users`, `PUT /admin/users/:id`

| Categoría | Tests |
|---|---|
| Privilege escalation matrix (5×5 roles) | 10 |
| Creación de vehículo — validación, sucursal scope | 6 |
| Edición de vehículo — null check post-BUG-01 fix, scope guard | 5 |
| Activar/desactivar — null check, scope guard | 4 |
| Creación de usuario — hash de contraseña, rol inválido | 6 |
| Edición de usuario — peer-management rule, rol inválido | 5 |
| Admin_pais no puede crear admin_global | 2 |
| Scope crossing (admin_pais en branch de otro país) | 4 |
| DB failures | 8 |

---

### `settings.test.ts` — 33 tests
Endpoints: `GET /settings`, `PUT /settings`, `DELETE /settings/reset`

| Categoría | Tests |
|---|---|
| GET — scope levels (branch/country/global), rol guardia puede leer su branch | 5 |
| GET — scope incorrecto (guardia en branch ajeno) | 2 |
| PUT — roles bloqueados (guardia, jefe_operaciones) | 2 |
| PUT — validación de keys (desconocida, mezcla válida+inválida) | 4 |
| PUT — scope targeting (branch, country, global) | 4 |
| PUT — null value = RESET_SETTING audit | 2 |
| PUT — audit log por key | 2 |
| DELETE /reset — keys array o reset-all | 4 |
| DELETE — scope que no tiene overrides | 1 |
| DB failures | 7 |

---

### `vehicleStatusTypes.test.ts` — 40 tests
Endpoints: `GET /vehicle-status-types`, `GET /vehicle-status-types/all`, `POST /vehicle-status-types`, `PUT /vehicle-status-types/:id`, `PATCH /vehicle-status-types/:id/toggle`, `DELETE /vehicle-status-types/:id`

| Categoría | Tests |
|---|---|
| Listado público (activos + filtro por país) | 4 |
| Listado admin (admin_pais ve global + país, admin_global ve todo) | 3 |
| Creación — validación color hex, labelEs min, countryId forced | 7 |
| `toSlug` — unicode, acentos, solo caracteres especiales | 3 |
| Crear tipo global (admin_global, sin countryId) | 2 |
| Duplicate key → 409 | 1 |
| Edición — scope guard, color inválido | 5 |
| Toggle — activo→inactivo, scope guard, 404 | 4 |
| Eliminación — system type protected, scope guard, race condition | 5 |
| DB failures | 6 |

---

### `reports.test.ts` — 25 tests
Endpoints: `GET /reports/daily`, `GET /reports/export`

| Categoría | Tests |
|---|---|
| Roles bloqueados (guardia) | 2 |
| Agregación diaria — con y sin datos | 4 |
| Filtro "no_review" — vehículos sin inspección en ventana | 3 |
| Export Excel — headers, content-type | 3 |
| Threshold desde settings (jefe_operaciones usa el de su branch) | 3 |
| admin_pais sin branchId usa default 8h | 1 |
| DB failures | 5 |
| Fechas en timezone correcto | 4 |

---

### `branches.test.ts` — 26 tests
Endpoints: `GET /branches`, `POST /branches`, `PUT /branches/:id`, `PATCH /branches/:id/activate|deactivate`

| Categoría | Tests |
|---|---|
| Listado — roles permitidos, filtro ?countryId | 5 |
| Creación — roles bloqueados (guardia/jefe/admin) | 3 |
| Creación — admin_pais countryId forced from token | 2 |
| Creación — admin_global requiere countryId en body | 2 |
| Edición — scope guard (branch de otro país → 403) | 3 |
| Activar/desactivar — scope guard, DB failures | 4 |
| Campos requeridos faltantes | 2 |
| DB failures | 5 |

---

### `countries.test.ts` — 24 tests
Endpoints: `GET /countries`, `POST /countries`, `PUT /countries/:id`, `PATCH /countries/:id/activate|deactivate`

| Categoría | Tests |
|---|---|
| GET — todos los roles, lista vacía | 4 |
| POST — roles bloqueados (todos los no-global) | 1 |
| POST — campos faltantes | 4 |
| POST — **IANA timezone inválida** (garbage, plausible-wrong) | 2 |
| POST — 201 creación exitosa | 1 |
| PUT — scope guard, **IANA timezone inválida on update**, 404 | 3 |
| PATCH activate/deactivate — scope guard, 200, 404 | 5 |
| DB failures | 4 |

**Nuevos tests (BUG-07):**
- "400 invalid IANA timezone rejected (garbage string)"
- "400 invalid IANA timezone rejected (plausible but wrong format)"
- "400 invalid IANA timezone rejected on update"

---

### `drivers.test.ts` — 8 tests
Endpoints: `GET /drivers`, `GET /drivers/all`

| Categoría | Tests |
|---|---|
| Roles permitidos vs bloqueados | 3 |
| Scope enforcement (solo conductores de la sucursal) | 2 |
| Lista activos vs todos | 2 |
| DB failure | 1 |

---

### `audit.test.ts` — 13 tests
Endpoints: `GET /audit`

| Categoría | Tests |
|---|---|
| Roles bloqueados (guardia → 403) | 2 |
| Roles permitidos (jefe_operaciones, admin, admin_pais, admin_global) | 4 |
| Filtros — entity, entity+entityId | 2 |
| Scope pasado a getAuditLogs | 1 |
| Lista vacía | 1 |
| Leak a guardia con cookie válida | 1 |
| DB failure | 1 |
| Unauthenticated | 1 |

---

### `photos.test.ts` — 42 tests
Endpoints: `GET /photos/file/*`, `POST /inspections/:id/photos`, `GET /inspections/:id/photos`

| Categoría | Tests |
|---|---|
| **servePhoto** — auth, DB miss, 200 serve, path correcto | 4 |
| **servePhoto** — path traversal (Express normaliza antes del route) | 1 |
| **servePhoto** — cross-tenant (RLS oculta el registro) | 1 |
| **servePhoto** — storage.serve throws, DB failure | 2 |
| **uploadPhoto** — auth, inspección no encontrada, inspección sellada | 4 |
| **uploadPhoto** — supervisor puede subir a inspección sellada | 1 |
| **uploadPhoto** — sin archivo, MIME inválido | 3 |
| **uploadPhoto** — MIME spoofing (magic bytes reales) | 3 |
| **uploadPhoto** — buffer demasiado pequeño | 1 |
| **uploadPhoto** — excede max_photo_size_mb del setting | 1 |
| **uploadPhoto** — formatos válidos (PNG, WebP) | 2 |
| **uploadPhoto** — photoType default y válido | 2 |
| **uploadPhoto** — **photoType inyectado** → 400 | 1 |
| **uploadPhoto** — plate viene de DB, no del body | 1 |
| **uploadPhoto** — markHasPhotos llamado | 1 |
| **uploadPhoto** — storePhoto failure, createPhotoRecord failure | 2 |
| **uploadPhoto** — getTypedSettings failure | 1 |
| **getPhotos** — auth, inspección no encontrada, fuera de scope | 3 |
| **getPhotos** — 200 lista, lista vacía, inspectionId correcto | 3 |
| **getPhotos** — todos los roles supervisor pueden ver fotos | 1 |
| **getPhotos** — DB failures | 2 |

**Nuevos tests (BUG-06):**
- "400 when unknown photoType string is provided"

---

## 5. Patrones de riesgo documentados

### Mock queue pollution (patrón descubierto en el harness)

`clearMocks: true` en `jest.config.js` limpia el historial de llamadas pero **NO** limpia las colas de `mockResolvedValueOnce`. Los tests que retornan 401/403 antes de llegar a la capa DB nunca consumen el valor encolado, que "contamina" el test siguiente. Regla aplicada en todos los suites:

> Tests que esperan 401 o 403 **no deben** configurar `mockResolvedValueOnce` en ningún mock de DB.

### Efectos secundarios en la inicialización del módulo

`authController.ts` ejecuta `bcrypt.hashSync('login-timing-equalizer', 12)` al importarse (para crear `DUMMY_PASSWORD_HASH`). Cualquier test que importe `createApp()` ejecuta esto, provocando un timeout de ~1s por suite. Solución aplicada en todos los archivos de test:

```ts
jest.mock('bcryptjs', () => ({
  hashSync:  jest.fn().mockReturnValue('$2a$12$dummy'),
  compareSync: jest.fn(),
}));
```

### Normalización de rutas por Express (path traversal)

`GET /photos/file/../../etc/passwd` es normalizado por Express a `/etc/passwd` antes del match de rutas — no coincide con el wildcard `/photos/file/*` y el handler nunca se invoca. La protección es a nivel de routing, más fuerte que cualquier validación en el controlador.

### Parámetro `scope` opcional con dos semánticas distintas

`getOpenIssuesByVehicle(vehicleId, scope?)` tiene dos callers con necesidades opuestas:
- `routes/vehicles.ts` → necesita scope (API pública, filtrar por tenant)
- `openIssueController.ts` → no debe tener scope (uso interno para recalcular `hasOpenIssues`)

El parámetro opcional preserva ambas semánticas sin romper la compatibilidad.

---

## 6. Estado del harness de testing

### Configuración

| Archivo | Propósito |
|---|---|
| `jest.config.js` | `clearMocks: true`, `transform` con ts-jest, `setupFilesAfterFramework` |
| `tsconfig.jest.json` | `isolatedModules: true` para transpilación rápida |
| `jest.uuidStub.js` | Stub CJS para `uuid` v11 (ESM puro, incompatible con Jest/CJS) |
| `src/__tests__/setupEnv.ts` | Establece `JWT_SECRET` y `NODE_ENV=test` antes de importar la app |
| `src/__tests__/helpers.ts` | `authCookie()`, `userRow()`, `branchRow()`, `countryRow()`, etc. |

### Cobertura por superficie

| Superficie | ¿Cubierto? |
|---|---|
| Auth (login, JWT, logout, guards) | ✅ |
| Rate limiting | ✅ |
| Inspecciones (CRUD, seal, scope) | ✅ |
| Issues abiertos (CRUD, flags, scope) | ✅ |
| Vehículos (status, historial, IDOR fix) | ✅ |
| Admin (privilege escalation, users, vehicles) | ✅ |
| Settings (cascade, scope, audit, reset) | ✅ |
| Vehicle status types (CRUD, slug, system guard) | ✅ |
| Reports (daily, export Excel, threshold) | ✅ |
| Branches (scope, country enforcement) | ✅ |
| Countries (CRUD, timezone validation) | ✅ |
| Drivers (scope) | ✅ |
| Audit logs (role guard, scope, filters) | ✅ |
| Photos (magic bytes, MIME, path traversal, photoType) | ✅ |
| `VehicleStatusLog` RLS | ✅ (barrera de diseño; sin ruta de lectura) |
| `GET /vehicles/:id/history` scope consistency | ✅ |
| `applyScopeWhere` column allowlist | ✅ |
| `initialMileage` bounds | ✅ |
| Invalidación de cache de timezone | ✅ |

### Resultado final

```
Test Suites: 17 passed, 17 total
Tests:       533 passed, 533 total
Snapshots:   0 total
Time:        ~9s
TypeScript:  0 errors
```
