/* ============================================================================
   create-app-user.sql
   Login + usuario de aplicación NO privilegiado (vi_app) para Row-Level Security
   ----------------------------------------------------------------------------
   Ejecutar UNA vez como `sa` (o cualquier login sysadmin) contra tu instancia
   local. Es IDEMPOTENTE: puedes correrlo varias veces sin error.

   POR QUÉ FALLÓ EL COMANDO SUELTO (error 15151):
     - El LOGIN vive a nivel de SERVIDOR (catálogo `master`).
     - El USER y la pertenencia a roles viven DENTRO de la base `Operaciones`.
     Si ejecutas `ALTER ROLE ... ADD MEMBER vi_app` sin estar posicionado en
     `Operaciones`, ese contexto no tiene un USER llamado vi_app → 15151.
     Este script hace `USE [Operaciones]` ANTES de crear el USER y los roles.

   AJUSTA ANTES DE EJECUTAR:
     1. La contraseña (abajo, en CREATE LOGIN): debe ser la MISMA que pongas en
        MSSQL_PASSWORD del .env que use Docker.
     2. El nombre de la base en `USE [Operaciones]` si tu catálogo se llama
        distinto (p. ej. `operaciones`).

   El usuario queda con db_datareader + db_datawriter (NO db_owner, NO sysadmin),
   que es justo lo que exige RLS y lo que el self-test de arranque verifica.
   ============================================================================ */

-- 1) LOGIN a nivel de servidor (master) — idempotente ------------------------
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'vi_app')
    CREATE LOGIN vi_app WITH PASSWORD = N'UnaClaveFuerte123!';
GO

-- 2) USER + permisos DENTRO de la base de la aplicación ----------------------
USE Operaciones;   -- <-- ajusta el nombre si tu base difiere
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'vi_app')
    CREATE USER vi_app FOR LOGIN vi_app;

IF IS_ROLEMEMBER('db_datareader', 'vi_app') = 0
    ALTER ROLE db_datareader ADD MEMBER vi_app;

IF IS_ROLEMEMBER('db_datawriter', 'vi_app') = 0
    ALTER ROLE db_datawriter ADD MEMBER vi_app;

-- sp_set_session_context ya es ejecutable por `public` por defecto, así que
-- vi_app puede llamarlo sin un GRANT explícito. Un GRANT sobre procedimientos del
-- sistema sólo puede hacerse desde la base `master` (no desde Operaciones), por
-- eso no se incluye aquí. Si en tu entorno se revocó a public, ejecuta en master:
--   USE master; GRANT EXECUTE ON sys.sp_set_session_context TO vi_app;
GO

-- 2b) Visibilidad de metadatos de las políticas RLS --------------------------
-- El self-test de arranque cuenta sys.security_policies. Por las reglas de
-- VISIBILIDAD DE METADATOS de SQL Server, un login no privilegiado NO ve los
-- objetos del esquema Security (las políticas) a menos que tenga VIEW DEFINITION
-- sobre ese esquema → las contaría como 0 y el contenedor abortaría en producción.
-- Se concede aquí de forma idempotente y SOLO si el esquema Security ya existe
-- (lo crea database/Operaciones.sql). Si aún no existe, re-ejecuta Operaciones.sql
-- DESPUÉS de este script: ese script también aplica este mismo GRANT.
IF EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'Security')
    GRANT VIEW DEFINITION ON SCHEMA::Security TO vi_app;
GO

-- 3) Verificación -------------------------------------------------------------
PRINT 'login vi_app:        ' + CASE WHEN (SELECT COUNT(*) FROM sys.server_principals  WHERE name='vi_app') > 0 THEN 'OK' ELSE 'FALTA' END;
PRINT 'usuario vi_app:      ' + CASE WHEN (SELECT COUNT(*) FROM sys.database_principals WHERE name='vi_app') > 0 THEN 'OK' ELSE 'FALTA' END;
PRINT 'db_datareader:       ' + CASE WHEN IS_ROLEMEMBER('db_datareader','vi_app')=1 THEN 'OK' ELSE 'FALTA' END;
PRINT 'db_datawriter:       ' + CASE WHEN IS_ROLEMEMBER('db_datawriter','vi_app')=1 THEN 'OK' ELSE 'FALTA' END;
PRINT 'NO es db_owner:      ' + CASE WHEN IS_ROLEMEMBER('db_owner','vi_app')=1 THEN 'ADVERTENCIA: es db_owner' ELSE 'OK' END;
PRINT 'VIEW DEF Security:   ' + CASE
    WHEN (SELECT COUNT(*) FROM sys.schemas WHERE name='Security') = 0
        THEN 'PENDIENTE (crea el esquema con Operaciones.sql y vuelve a ejecutar)'
    WHEN (
        SELECT COUNT(*)
        FROM   sys.database_permissions p
        JOIN   sys.database_principals  u ON p.grantee_principal_id = u.principal_id
        WHERE  u.name = 'vi_app'
        AND    p.permission_name = 'VIEW DEFINITION'
        AND    p.class_desc = 'SCHEMA'
        AND    p.major_id = SCHEMA_ID('Security')
        AND    p.state_desc = 'GRANT'
    ) > 0 THEN 'OK' ELSE 'FALTA (re-ejecuta Operaciones.sql)' END;
GO
