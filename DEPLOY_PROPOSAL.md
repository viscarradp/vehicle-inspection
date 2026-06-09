# Propuesta CI/CD y Deploy — Vehicle Inspection CM

## Diagnóstico del estado actual

| Problema | Impacto |
|---|---|
| Deploy manual via SCP/ZIP | Sin trazabilidad, error-prone, no repetible |
| Sin pipeline de CI | Nadie verifica tipos ni lint antes de subir código |
| Imagen no está en registry | El servidor construye desde cero en cada deploy |
| SQLite referenciado pero sin uso | Entrypoint.sh inútil, volumen `vi_data` fantasma |
| Sin sistema de migraciones DB | `Operaciones.sql` se corre una vez; cambios futuros no tienen mecanismo formal |

---

## Arquitectura objetivo

### Flujo CI/CD (Azure Pipelines)

```
Push a cualquier rama / PR
  └─ Stage: Validate
       ├─ Backend:  npm ci → tsc --noEmit
       └─ Frontend: npm ci → tsc --noEmit

Merge a main
  └─ Stage: Validate          (ídem)
  └─ Stage: Build & Push
       ├─ docker build (multi-stage)
       └─ docker push → ACR
            tags: <build-id>  (inmutable, trazable)
                  latest      (para rollback rápido)
  └─ Stage: Deploy
       └─ SSH al servidor físico
            ├─ docker login ACR
            ├─ docker compose pull app
            ├─ docker compose up -d --no-build
            └─ docker image prune -f
```

### Stack de infraestructura

| Componente | Tecnología | Notas |
|---|---|---|
| Source control | Azure DevOps Repos | Rama principal: `main` |
| CI/CD | Azure Pipelines | `azure-pipelines.yml` en raíz |
| Registry | Azure Container Registry (ACR) | Imagen: `vehicle-inspection` |
| Servidor | Físico, Docker Compose | `/opt/vi` en el servidor |
| Base de datos | SQL Server existente | Sin contenedor, solo conexión |
| Reverse proxy | nginx 1.27-alpine | SSL termination + rate limiting |

### Sistema de migraciones DB

El backend corre `runMigrations()` al arranque, **antes** de aceptar tráfico.

```
Primera vez (setup DBA — solo una vez):
  Correr database/Operaciones.sql contra SQL Server

Arranque de la app (automático en cada deploy):
  runMigrations() → src/db/migrate.ts
    1. Crea tabla schema_migrations si no existe
    2. Detecta si el schema ya estaba bootstrapped (baseline automático)
    3. Aplica en orden los archivos pendientes en database/migrations/*.sql
    4. Registra cada versión aplicada con timestamp
```

Archivos de migración: `database/migrations/NNN_descripcion.sql`
Ejemplo: `002_add_vehicle_photos_index.sql`

---

## Configuración requerida en Azure DevOps

### 1. Azure Container Registry

1. Crear ACR en Azure Portal (ej. `viregistry`)
2. En **Project Settings → Service Connections** crear:
   - Tipo: **Docker Registry → Azure Container Registry**
   - Nombre: `acr-service-connection`

### 2. SSH al servidor de producción

En **Project Settings → Service Connections** crear:
- Tipo: **SSH**
- Nombre: `prod-server-ssh`
- Host, User y clave privada del servidor

### 3. Variable Group: `vi-prod`

En **Pipelines → Library → Variable Groups**:

| Variable | Ejemplo | ¿Secreto? |
|---|---|---|
| `ACR_REGISTRY` | `viregistry.azurecr.io` | No |
| `ACR_USER` | `<app-id del service principal>` | No |
| `ACR_PASSWORD` | `<secret del service principal>` | **Sí** |

### 4. Servidor — preparación única (antes del primer deploy)

```bash
# Instalar Docker
curl -fsSL https://get.docker.com | sh && usermod -aG docker $USER

# Crear directorio
mkdir -p /opt/vi && cd /opt/vi

# Copiar desde el repo:
#   docker-compose.prod.yml
#   nginx/
#   .env  (crear desde backend/.env.example con valores reales)

# Colocar certificados SSL
#   nginx/ssl/cert.pem
#   nginx/ssl/key.pem

# Correr el schema inicial (UNA SOLA VEZ)
#   sqlcmd -S <host> -U <user> -P <pass> -i database/Operaciones.sql
```

---

## docker-compose.prod.yml — cambios necesarios para el pipeline

Cuando se implemente el pipeline, el compose de producción cambia de `build:` local a `image:` desde ACR:

```yaml
# Antes (construye en el servidor):
app:
  build:
    context: .
    dockerfile: Dockerfile

# Después (descarga imagen ya construida):
app:
  image: ${ACR_REGISTRY}/vehicle-inspection:${IMAGE_TAG:-latest}
```

El servidor recibe `IMAGE_TAG` como variable de entorno del paso SSH del pipeline.

---

## Pasos para implementar (cuando llegue la orden)

- [ ] 1. Crear ACR en Azure Portal
- [ ] 2. Crear service connections en Azure DevOps (ACR + SSH)
- [ ] 3. Crear variable group `vi-prod` con las 3 variables
- [ ] 4. Preparar servidor: Docker, directorio, .env, SSL certs
- [ ] 5. Correr `Operaciones.sql` en SQL Server (única vez)
- [ ] 6. Crear `azure-pipelines.yml`
- [ ] 7. Crear `backend/src/db/migrate.ts` + actualizar `index.ts`
- [ ] 8. Actualizar `docker-compose.prod.yml` para usar imagen ACR
- [ ] 9. Crear `database/migrations/` (directorio para migraciones futuras)
- [ ] 10. Primer push a `main` → pipeline automático

---

## Notas de seguridad

- `.env` nunca se commitea (ya en `.gitignore`)
- Los secrets viven en Azure DevOps Library (nunca en el YAML del pipeline)
- El pipeline construye la imagen en un agente efímero, no en el servidor de prod
- El servidor solo descarga imágenes ya construidas y verificadas
- La imagen corre como usuario no-root (`appuser`) en el contenedor
