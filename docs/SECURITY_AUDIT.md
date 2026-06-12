# Runbook de verificación — Remediación de auditoría (Fases 1–4)

Ejecutar contra un entorno con SQL Server vivo (ideal: una BD de staging idéntica a
producción). La verificación estática (typecheck `tsc --noEmit`) ya pasa.

> **Login no privilegiado (prerequisito).** RLS sólo funciona si la app NO conecta
> como `db_owner`/`sysadmin`. El arranque ahora lo verifica y **aborta en producción**
> si detecta un login privilegiado o políticas RLS deshabilitadas (ver `index.ts`).
> Crear el login dedicado ejecutando, **como `sa`**, el script idempotente
> [`database/create-app-user.sql`](database/create-app-user.sql) (maneja bien el
> scope servidor↔base; ajusta antes la contraseña y el nombre de la base).

---

## 1. Arranque / self-test de RLS (Fase 3)
- [ ] Iniciar la app. En consola debe verse `[security] RLS self-test — login privilegiado: no, políticas habilitadas: 6`.
- [ ] Conectar deliberadamente como `sa` con `NODE_ENV=production` → el proceso debe **abortar** con el FATAL de seguridad.

## 2. Aislamiento de tenant (Fase 2 / A1, A2)
Autenticarse como `admin` de la Sucursal A y, con su cookie, intentar tocar recursos de la Sucursal B:
- [ ] `GET /vehicles/:idDeB` → **404** (RLS oculta la fila; antes podía filtrarse).
- [ ] `GET /inspections/:idDeB` → **404**.
- [ ] `GET /audit-logs?entity=Inspection&entityId=:idDeB` → la respuesta **no** debe contener registros de B. Repetir sin filtros: sólo aparecen filas de la Sucursal A.
- [ ] Como `admin_pais` de País X con `?branchId=` de una sucursal de País Y → **403 BRANCH_OUT_OF_SCOPE** (lo bloquea `requireValidBranchContext`, ahora también en `/audit-logs`).
- [ ] `GET /photos/file/<ruta de una foto de B>` autenticado como A → **404** (antes servía el archivo por conocer la ruta).
- [ ] Subir una foto y confirmar en BD que `Photos.VehicleId/Plate` corresponden a la inspección, **no** a lo que mande el cliente (M3).

## 3. Atomicidad — commit/rollback por request (Fase 1 / C3)
- [ ] `PUT /settings` con un cuerpo mixto válido+inválido (p.ej. `{ "shift_morning_start": 6, "audit_log_retention_days": 999999 }`). Debe responder 4xx y, al re-consultar, **ninguno** de los dos debe haberse aplicado (antes el válido quedaba committeado).
- [ ] Forzar un fallo a mitad del flujo de inspección (temporalmente lanzar tras `createInspection`) y verificar que **no** quedó inspección ni incidencia ni cambio de estado persistido.

## 4. Regresión C1 — dashboard (Fase 1)
- [ ] `GET /inspections/dashboard` → **200** con datos (antes: 500 por "connection is busy" del `Promise.all`).

## 5. Regresión C2 — deadlock de cambio de estado (Fase 1)
- [ ] Poner un vehículo en `workshop`. Como guardia, registrarlo como `received` **con kilometraje**.
- [ ] La respuesta debe ser **inmediata** (antes: colgaba ~30s y devolvía 500 por lock-wait). Verificar `VehicleStatusLog` y `CurrentStatus='active'`.

## 6. Settings cache por request (Fase 3 / M2)
- [ ] Con SQL Profiler / Extended Events, observar una carga de dashboard: la consulta de `Settings` debe ejecutarse **una sola vez** por request, no 2–3.

## 7. Límite de tamaño de foto configurable (Fase 3 / M4)
- [ ] Bajar `max_photo_size_mb` a 1 en una sucursal. Subir una foto > 1 MB → **400 FILE_TOO_LARGE** con el valor configurado en el mensaje.

## 8. Validación de parámetros (Fase 4)
- [ ] `GET /reports/daily?date=basura` → **400 INVALID_DATE** (antes: 500).
- [ ] `GET /reports/no-review?days=abc` → **400** (antes: resultados silenciosamente incorrectos).

## 9. Carga / saturación de pool (Fase 1 / M1)
- [ ] Lanzar > 50 requests concurrentes sostenidos (k6/autocannon). El pool (50) debe absorberlos; al saturar, las peticiones excedentes deben **fallar rápido** (error de adquisición ~15s → 500), **no** colgar indefinidamente. Confirmar que no hay conexiones retenidas 30s.

---

### Tests automatizados (opcional, requiere BD de test)
El proyecto no tiene runner configurado. Si se desea CI: añadir `vitest` + un esquema
de test efímero (contenedor `mcr.microsoft.com/mssql/server`), y portar los puntos
2–5 a tests de integración. Las funciones puras (`settingsRegistry`, `queryParams`,
`roleCapabilities`, `resolveScope`) son testeables sin BD.
