# Vehicle Inspection CM — Gestión de Flota

Sistema multi-país (PA · GT · SV · NI) para el control de vehículos en las garitas
de Grupo ConstruMarket. Los guardias registran el estado de cada vehículo por turno
(kilometraje, daños, herramientas, fotos) y operaciones/administración supervisan en
tiempo real. Modelo de **stream puro de eventos** (cada inspección es un evento
autocontenido; no hay sesiones que "enviar").

**Stack:** Node.js 20 · TypeScript · Express · SQL Server (driver `mssql`, sin ORM) ·
React 18 + Vite · Tailwind/shadcn · Docker + nginx.

| Componente | Puerto (dev) | Notas |
|---|---|---|
| Frontend (Vite) | `5173` | Proxya `/api` → backend |
| Backend (Express) | `3001` | API + `/health` |
| SQL Server | `1433` | Externo (nativo) o contenizado (Opción 2) |

---

## Requisitos Previos

| Herramienta | Versión | ¿Para qué? |
|---|---|---|
| **Git** | — | Clonar el repositorio |
| **Docker + Compose v2** | Docker 24+ | Opción 2 (dev automatizado) y producción |
| **Node.js + npm** | Node **20** | Opción 1 (dev nativo) |
| **SQL Server** | 2019/2022 o Azure SQL | Opción 1 (dev nativo) y producción. La Opción 2 lo levanta en contenedor. |

> En **Apple Silicon (Mac M1/M2/M3)** la Opción 2 corre la base de datos con la
> imagen `azure-sql-edge` (multi-arquitectura) de forma **nativa**, sin emulación.

---

## Despliegue en Desarrollo · Opción 1 (Nativo)

Usa tu propio SQL Server y corre el backend/frontend con Node directamente.

```bash
# 1. Clonar e instalar dependencias
git clone <repo> && cd Vehicle-Inspection-CM
npm install --prefix backend
npm install --prefix frontend

# 2. Configurar variables del backend
cp backend/.env.example backend/.env
#    Edita backend/.env: MSSQL_HOST/PORT/USER/PASSWORD apuntando a tu SQL Server,
#    JWT_SECRET, etc. Para SQL Server local sin SSL: MSSQL_ENCRYPT=false, MSSQL_TRUST_CERT=true
```

```bash
# 3. Preparar la base de datos (una sola vez), como sa o un login admin:
sqlcmd -S localhost -U sa -P '<pass>' -i database/Operaciones.sql       # schema + RLS
sqlcmd -S localhost -U sa -P '<pass>' -i database/create-app-user.sql   # usuario vi_app
#    (También puedes correrlos desde Azure Data Studio / SSMS.)

# 4. Sembrar datos de ejemplo (usuarios, sucursales, flota)
npm run db:seed        # desde la raíz (equivale a: npm run db:seed --prefix backend)
```

```bash
# 5. Levantar (dos terminales, o usa & en una)
npm run backend        # Express con hot-reload → http://localhost:3001
npm run frontend       # Vite con hot-reload    → http://localhost:5173
```

Abre **http://localhost:5173**. Las credenciales sembradas se imprimen en la consola
del seed (usuario `admin` y los `admin.<país>`).

> Scripts útiles: `npm run db:reset` (limpia y re-siembra), `npm test --prefix backend`.

---

## Despliegue en Desarrollo · Opción 2 (Automatizado)

Levanta **todo** en contenedores —base de datos incluida— con un solo comando.
No necesitas Node ni SQL Server instalados; solo Docker.

```bash
# 1. Clonar
git clone <repo> && cd Vehicle-Inspection-CM

# 2. El backend necesita un .env (la conexión a la DB la sobreescribe el compose,
#    pero JWT_SECRET y demás se leen de aquí):
cp backend/.env.example backend/.env

# 3. Levantar el stack completo
docker compose -f docker-compose.dev.yml up
```

Qué ocurre al levantar:

1. **`db`** — SQL Server (`azure-sql-edge`, multi-arch / nativo en Apple Silicon).
2. **`db-init`** — corre una vez: aplica `database/Operaciones.sql` y
   `create-app-user.sql` (bootstrap) y luego siembra datos de ejemplo. Sale al terminar.
3. **`backend`** — Node con hot-reload, conectado como el usuario no privilegiado
   `vi_app` (ejerce la RLS igual que producción).
4. **`frontend`** — Vite con hot-reload.

Cuando `vi_db_init` termine (verás el resumen del seed y sus usuarios), abre
**http://localhost:5173**.

```bash
# Detener:        Ctrl-C
# Reset total (borra la base de datos del contenedor):
docker compose -f docker-compose.dev.yml down -v
```

---

## Despliegue en Producción

Producción usa `docker-compose.prod.yml` (contenedor `app` + `nginx` con SSL) contra
un **SQL Server externo**. Resumen:

```bash
# 1. En el servidor: instalar Docker + Compose, clonar/copiar el proyecto a /opt/vi
# 2. Configurar backend/.env con valores reales (JWT_SECRET, ALLOWED_ORIGIN,
#    PUBLIC_BASE_URL y MSSQL_* apuntando al SQL Server, usuario vi_app)
cp backend/.env.example backend/.env && nano backend/.env

# 3. Preparar la base de datos (una sola vez) en el SQL Server externo:
sqlcmd -S <host> -U sa -P '<pass>' -i database/Operaciones.sql
sqlcmd -S <host> -U sa -P '<pass>' -i database/create-app-user.sql
ADMIN_PASSWORD='<pass-admin>' npm run seed:prod --prefix backend

# 4. Colocar el certificado SSL en nginx/ssl/cert.pem y nginx/ssl/key.pem
#    y ajustar server_name en nginx/nginx.conf

# 5. Construir y levantar
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # vi_app (healthy) + vi_nginx
```

📖 **Runbook completo** (servidor, SSL/Let's Encrypt, backups, hardening,
mantenimiento): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
Propuesta de CI/CD (Azure Pipelines + ACR): [`docs/CICD_PROPOSAL.md`](docs/CICD_PROPOSAL.md).

---

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitectura y decisiones (fuente de verdad técnica) |
| [`docs/MANUAL_PROCESOS_NEGOCIO.md`](docs/MANUAL_PROCESOS_NEGOCIO.md) | Manual de procesos de negocio (no técnico) |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Guía de despliegue en producción |
| [`docs/CICD_PROPOSAL.md`](docs/CICD_PROPOSAL.md) | Propuesta de CI/CD (futura) |
| [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) | Runbook de verificación de seguridad / RLS |
| [`backend/src/__tests__/README.md`](backend/src/__tests__/README.md) | Estrategia de pruebas |
