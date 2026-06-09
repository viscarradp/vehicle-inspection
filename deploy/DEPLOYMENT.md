# Guía de Despliegue — Vehicle Inspection App

**Versión**: 1.0  
**Stack**: Node.js 20 · SQLite · Docker · nginx  
**Tiempo estimado de despliegue**: 30-60 minutos  

---

## Requisitos del servidor

| Componente | Mínimo |
|---|---|
| SO | Ubuntu 22.04 LTS / Debian 12 (recomendado) |
| CPU | 2 vCPU |
| RAM | 1 GB |
| Disco | 20 GB SSD |
| Software | Docker 24+ y Docker Compose v2 |
| Red | Puerto 80 y 443 abiertos al exterior |

---

## 1. Preparar el servidor

```bash
# Actualizar paquetes
sudo apt update && sudo apt upgrade -y

# Instalar Docker + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo apt install -y docker-compose-plugin

# Agregar tu usuario al grupo docker (requiere re-login)
sudo usermod -aG docker $USER
```

---

## 2. Subir el proyecto al servidor

Desde tu máquina local (Windows), usando SCP o WinSCP:

```powershell
# Desde PowerShell en tu PC
scp VehicleInspection-production.zip usuario@IP_SERVIDOR:/opt/
```

En el servidor:

```bash
cd /opt
sudo unzip VehicleInspection-production.zip
sudo mv VehicleInspection-production vi
cd /opt/vi
```

---

## 3. Configurar variables de entorno

```bash
# Copiar la plantilla
cp .env.production.example .env

# Editar con tus valores reales
nano .env
```

### Variables OBLIGATORIAS que debes cambiar:

| Variable | Descripción |
|---|---|
| `JWT_SECRET` | Secreto aleatorio ≥ 64 caracteres. Ver comando abajo. |
| `ALLOWED_ORIGIN` | URL exacta de tu dominio, ej: `https://inspeccion.miempresa.com` |
| `PUBLIC_BASE_URL` | Igual que ALLOWED_ORIGIN |

**Generar JWT_SECRET seguro:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 4. Certificado SSL

### Opción A: Let's Encrypt (dominio público, RECOMENDADO)

```bash
sudo apt install -y certbot

# Detener nginx si corre en host (no debería)
# Generar certificado en modo standalone
sudo certbot certonly --standalone -d inspeccion.miempresa.com

# Copiar certificados a la carpeta nginx del proyecto
sudo cp /etc/letsencrypt/live/inspeccion.miempresa.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/inspeccion.miempresa.com/privkey.pem   nginx/ssl/key.pem
sudo chmod 600 nginx/ssl/key.pem
```

### Opción B: Certificado propio de la empresa (wildcard, etc.)

Colocar los archivos como:
```
nginx/ssl/cert.pem   ← Certificado completo (cadena incluida)
nginx/ssl/key.pem    ← Llave privada
```

### Editar el dominio en nginx.conf

```bash
nano nginx/nginx.conf
```
Cambiar la línea `server_name _;` (en el bloque HTTPS) por:
```
server_name inspeccion.miempresa.com;
```

---

## 5. Levantar los servicios

```bash
# Construir imagen y levantar (primer deploy)
docker compose -f docker-compose.prod.yml up -d --build

# Ver logs en tiempo real
docker compose -f docker-compose.prod.yml logs -f
```

Verificar que todo esté activo:

```bash
docker compose -f docker-compose.prod.yml ps
# Deben aparecer vi_app (healthy) y vi_nginx (running)
```

Probar desde el servidor:
```bash
curl http://localhost:3001/health
# Esperado: {"status":"ok","timestamp":"..."}
```

Desde el navegador: abrir `https://inspeccion.miempresa.com`

---

## 6. Primer inicio de sesión

El sistema incluye la base de datos inicial con los usuarios registrados.  
Ingresar con las credenciales configuradas durante la fase de desarrollo.

> **Nota de seguridad**: Cambiar los PINs de todos los usuarios en el primer ingreso  
> desde el panel de Gestión (⚙) → pestaña Usuarios.

---

## 7. Operaciones de mantenimiento

### Actualizar la aplicación

```bash
# Subir el nuevo ZIP al servidor y extraer
cd /opt/vi
docker compose -f docker-compose.prod.yml down
# Reemplazar archivos (sin borrar nginx/ssl/ ni .env)
docker compose -f docker-compose.prod.yml up -d --build
```

### Ver logs

```bash
# App Node.js
docker logs vi_app --tail 100 -f

# nginx
docker logs vi_nginx --tail 100 -f
```

### Backup de la base de datos

```bash
# Crear backup con timestamp
docker exec vi_app sh -c \
  "sqlite3 /app/data/vehicle_inspection.db '.backup /app/data/backup_\$(date +%Y%m%d_%H%M%S).db'"

# Copiar backup al host
docker cp vi_app:/app/data/ ./backups/
```

### Backup de fotos

```bash
# Las fotos están en el volumen vi_uploads
docker run --rm \
  -v vi_uploads:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/uploads_$(date +%Y%m%d).tar.gz /data
```

### Renovar certificado Let's Encrypt (automatizar con cron)

```bash
# Agregar al crontab (renovar dos veces al mes)
echo "0 3 1,15 * * certbot renew --quiet && \
  cp /etc/letsencrypt/live/TU_DOMINIO/fullchain.pem /opt/vi/nginx/ssl/cert.pem && \
  cp /etc/letsencrypt/live/TU_DOMINIO/privkey.pem /opt/vi/nginx/ssl/key.pem && \
  docker exec vi_nginx nginx -s reload" | sudo crontab -
```

---

## 8. Hardening adicional recomendado

- [ ] Configurar firewall (`ufw allow 80; ufw allow 443; ufw allow 22; ufw enable`)
- [ ] Deshabilitar acceso root por SSH (`PermitRootLogin no` en `/etc/ssh/sshd_config`)
- [ ] Instalar `fail2ban` para proteger SSH contra fuerza bruta
- [ ] Habilitar actualizaciones automáticas de seguridad: `unattended-upgrades`
- [ ] Configurar backups automáticos diarios de la base de datos
- [ ] Monitorear con `docker stats` o integrar con Prometheus/Grafana

---

## 9. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `502 Bad Gateway` | App no levantó | `docker logs vi_app` para ver el error |
| `SSL handshake failed` | Certificado incorrecto | Verificar rutas en `nginx/ssl/` |
| `CORS error` en navegador | `ALLOWED_ORIGIN` mal configurado | Actualizar `.env` y reiniciar |
| Login no funciona | `JWT_SECRET` vacío o corto | Verificar `.env`, mínimo 32 chars |
| Fotos no se suben | Directorio sin permisos | `docker exec vi_app chown appuser /app/uploads` |
| Base de datos bloqueada | Múltiples instancias | Verificar que solo corra un contenedor `vi_app` |

---

## 10. Arquitectura del sistema

```
Internet
   │
   ▼
[nginx :443 SSL]
   ├── /uploads/* ──────────────────── Archivos estáticos (directo)
   ├── /api/*  ─── proxy ──────────── [Node.js :3001]
   └── /* ─────── proxy ──────────── [Node.js :3001] → SPA index.html
                                            │
                                      [SQLite WAL]
                                      /app/data/
```

---

*Generado automáticamente — Vehicle Inspection App v1.0*
