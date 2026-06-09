# Integration Tests — Vehicle Inspection Backend

Pruebas de integración con **Jest + Supertest**. Corren 100 % en memoria: sin base de datos, sin red, sin variables de entorno de producción.

---

## Requisitos

```bash
# Instalar dependencias (una sola vez)
cd backend
npm install
```

---

## Cómo ejecutar

| Comando | Qué hace |
|---|---|
| `npm test` | Corre todos los suites una vez |
| `npm run test:watch` | Re-corre en cada cambio (TDD) |
| `npm run test:coverage` | Genera reporte de cobertura en `/coverage` |

```bash
# Ejemplo de salida esperada
PASS src/__tests__/authRateLimit.test.ts
PASS src/__tests__/auth.test.ts

Test Suites: 2 passed, 2 total
Tests:       32 passed, 32 total
```

---

## Arquitectura del harness

### ¿Por qué no tocan la base de datos?

El backend usa **`mssql`** con transacciones por request (RLS). Para aislar los tests se mockean los módulos que abren conexiones reales:

| Módulo mockeado | Razón |
|---|---|
| `../middleware/dbContext` | Abre una transacción SQL por request. Reemplazado por un `next()` passthrough. |
| `../db/users` | Capa de acceso a datos. Los tests controlan sus valores de retorno y pueden forzar errores. |
| `bcryptjs` | Evita el coste real de bcrypt (cost-12) en cada test. |
| `express-rate-limit` | Deshabilitado en `auth.test.ts` para poder disparar muchos intentos fallidos sin activar el throttle. El limiter real se prueba por separado en `authRateLimit.test.ts`. |

**`jsonwebtoken` NO se mockea.** Se firman y verifican cookies `vi_token` reales para ejercitar la autenticación de extremo a extremo.

### Archivos del harness

```
backend/
├── jest.config.js          # Configuración de Jest (transform, moduleNameMapper, setupFiles)
├── tsconfig.jest.json      # Extiende tsconfig.json + isolatedModules para transpilación rápida
├── jest.uuidStub.js        # Stub CJS para uuid v11 (ESM puro, incompatible con Jest/CommonJS)
└── src/__tests__/
    ├── setupEnv.ts         # Establece JWT_SECRET y NODE_ENV antes de importar la app
    ├── helpers.ts          # authCookie() y userRow() — factorías reutilizables entre suites
    ├── auth.test.ts        # Suite principal (ver abajo)
    └── authRateLimit.test.ts
```

---

## Suites

### `auth.test.ts` — 30 tests

Cubre los cuatro endpoints de `/auth` bajo la filosofía del **"usuario caótico"**: asume que el frontend está roto o que hay un atacante.

#### `POST /auth/login`

| Caso | HTTP esperado | Descripción |
|---|---|---|
| Credenciales válidas | **200** | Devuelve `LOGIN_SUCCESS` y setea cookie `vi_token` HttpOnly |
| El hash de contraseña nunca llega al cliente | **200** | `data.user` no contiene `passwordHash` |
| Username con espacios y mayúsculas | **200** | Se normaliza (`trim + toLowerCase`) antes del lookup |
| Body vacío | **400** | `MISSING_CREDENTIALS` |
| Falta `password` | **400** | `MISSING_CREDENTIALS` |
| Falta `username` | **400** | `MISSING_CREDENTIALS` |
| Credenciales `null` | **400** | `MISSING_CREDENTIALS` |
| Strings vacíos `""` | **400** | `MISSING_CREDENTIALS` |
| Usuario inexistente | **401** | `INVALID_CREDENTIALS`; bcrypt corre igual (anti-timing) |
| Contraseña incorrecta | **401** | `INVALID_CREDENTIALS` |
| Usuario inactivo | **401** | `INVALID_CREDENTIALS` |
| Guardia sin sucursal asignada | **403** | `USER_MISCONFIGURED` |
| `admin_pais` sin país asignado | **403** | `USER_MISCONFIGURED` |
| Username SQL-injection | **401** | Tratado como dato, no ejecutado |
| `Content-Type: text/plain` | **400** | Body no parseado |
| Username numérico | **500** | Documenta falta de validación de tipos (ver nota) |
| Username solo espacios | **401** | Pasa el guard, se busca `""` en DB |
| JSON malformado | **500** | body-parser lanza; errorHandler no lo mapea a 400 (ver nota) |
| DB caída durante lookup | **500** | `INTERNAL_ERROR` sin filtrar detalles internos |
| DB caída no colapsa el servidor | **200** en `/health` | El proceso sigue vivo tras el 500 |
| `GET /auth/login` | **404** | Método no definido |

#### `GET /auth/me`

| Caso | HTTP esperado |
|---|---|
| Sin cookie | **401** `UNAUTHORIZED` |
| Cookie con valor basura | **401** `INVALID_TOKEN` |
| Token expirado | **401** `INVALID_TOKEN` |
| Token firmado con otro secret | **401** `INVALID_TOKEN` |
| Token válido | **200** con el payload del usuario |

#### `POST /auth/logout`

| Caso | HTTP esperado |
|---|---|
| Sin cookie | **401** (el endpoint está protegido por `requireAuth`) |
| Token válido | **200** `LOGOUT_SUCCESS` + cookie borrada |

#### `GET /auth/guards`

| Caso | HTTP esperado |
|---|---|
| Sin cookie | **401** |
| Token válido | **200** con la lista de usuarios kiosco |
| DB caída | **500** sin colapsar el servidor |

---

### `authRateLimit.test.ts` — 2 tests

Prueba el **limitador de fuerza bruta real** (`express-rate-limit`) sobre el endpoint de login.

> A diferencia de `auth.test.ts`, este suite **no** mockea `express-rate-limit`.

| Caso | HTTP esperado |
|---|---|
| Intentos 1–8 con credenciales incorrectas | **401** (permitidos) |
| 9.º intento fallido | **429** `RATE_LIMITED` |

---

## Hallazgos documentados como tests

Los siguientes comportamientos no son bugs que se hayan corregido, pero quedaron fijados como aserciones para que futuras refactorizaciones no los cambien sin querer, y para señalar oportunidades de hardening:

1. **Username numérico → 500** (no 400). El guard `if (!username || !password)` es truthy para un número; luego `username.trim()` lanza. Solución recomendada: validar la forma del body con zod antes de usarlo.

2. **Username de solo espacios → 401** (no 400). Es truthy, pasa el guard, se hace trim a `""` y se busca en DB. Mismo fix: zod.

3. **JSON malformado → 500** (no 400). `errorHandler` solo mapea instancias de `AppError`; los errores de body-parser caen al handler genérico. Solución: interceptar errores con `type === 'entity.parse.failed'` y devolver 400.

---

## Añadir tests para otro controlador

1. Crear `src/__tests__/<controlador>.test.ts`.
2. Mockear los módulos de DB que use (`jest.mock('../db/...')`).
3. Siempre mockear `../middleware/dbContext` con el passthrough.
4. Reusar `authCookie()` y `userRow()` de `helpers.ts`.
5. Correr `npm run test:watch` durante el desarrollo.
