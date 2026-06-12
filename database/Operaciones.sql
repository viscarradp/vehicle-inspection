-- ============================================================
--  Operaciones — Script de creación completo
--  SQL Server / Azure SQL
--  Versión: 3.0  |  Modelo: stream puro de eventos (sin sesiones)
--  Incluye: multi-país, multi-sucursal (PA, GT, SV, NI)
--
--  CAMBIO v2.0: se elimina InspectionSessions. Cada inspección es un
--  evento autocontenido, estampado con BranchId + LocalDate + Shift
--  (calculado server-side por la hora local de la sucursal).
--
--  CAMBIO v2.1: columna Direction ('entry'|'exit', DEFAULT 'entry') +
--  índice único UX_Inspections_Bucket(BranchId,VehicleId,LocalDate,Shift,Direction).
--
--  CAMBIO v2.2: tabla VehicleStatusTypes (estados especiales configurables).
--
--  CAMBIO v3.0 — Endurecimiento de integridad y normalización:
--    * Orden de creación reordenado (VehicleStatusTypes antes de Vehicles).
--    * Integridad referencial de autoría: las columnas de actor que guardaban
--      el Id de usuario como texto pasan a INT con FK a Users:
--         Inspections.CreatedBy  -> CreatedById
--         Inspections.ModifiedBy -> ModifiedById
--         OpenIssues.ClosedBy    -> ClosedById
--         Photos.UploadedBy      -> UploadedById
--         Vehicles.CurrentStatusBy        -> CurrentStatusById
--         VehicleStatusLog.ChangedBy      -> ChangedById
--         AuditLogs.UserId                -> FK a Users(Id)
--      (Se conservan como NVARCHAR solo los actores de texto libre / etiqueta:
--       Inspections.AuthorizedBy y OpenIssues.DetectedBy.)
--    * Vehicles.CurrentStatus ahora tiene FK a VehicleStatusTypes([Key]).
--      Se siembra el estado base 'active' como tipo de sistema para cerrar
--      el dominio a nivel de motor (además de la validación en la app).
--    * Unicidad real de identificadores físicos del vehículo: índices únicos
--      filtrados sobre Vin, ChassisNumber y EngineNumber (WHERE ... IS NOT NULL).
--    * Consistencia rol↔scope en Users vía CHECK (CK_Users_RoleScope).
--    * Fotos normalizadas a una sola fuente de verdad: se elimina
--      OpenIssues.PhotoUrls (array JSON, violaba 1NF). Photos gana OpenIssueId
--      (FK) y InspectionId pasa a NULLABLE, con CHECK de "al menos un padre".
--    * Countries.UpdatedAt por consistencia con el resto de maestras.
-- ============================================================

-- ------------------------------------------------------------
--  1. CREAR BASE DE DATOS
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'Operaciones')
BEGIN
    CREATE DATABASE Operaciones
        COLLATE Latin1_General_CI_AS;
    PRINT 'Base de datos Operaciones creada.';
END
GO

USE Operaciones;
GO

-- ============================================================
--  2. TABLAS MAESTRAS (multi-país / multi-sucursal)
-- ============================================================

-- ------------------------------------------------------------
--  Countries
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Countries')
BEGIN
    CREATE TABLE Countries (
        Id          INT             IDENTITY(1,1)   PRIMARY KEY,
        Code        NVARCHAR(5)     NOT NULL UNIQUE,   -- PA, GT, SV, NI
        Name        NVARCHAR(100)   NOT NULL,
        Timezone    NVARCHAR(60)    NOT NULL,           -- America/Panama, etc.
        Active      BIT             NOT NULL DEFAULT 1,
        CreatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
    PRINT 'Tabla Countries creada.';
END
GO

-- ------------------------------------------------------------
--  Branches  (sucursales por país)
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Branches')
BEGIN
    CREATE TABLE Branches (
        Id          INT             IDENTITY(1,1)   PRIMARY KEY,
        CountryId   INT             NOT NULL REFERENCES Countries(Id),
        Code        NVARCHAR(20)    NOT NULL UNIQUE,   -- PA-CENTRAL, GT-NORTE, etc.
        Name        NVARCHAR(150)   NOT NULL,
        Address     NVARCHAR(300)   NULL,
        Active      BIT             NOT NULL DEFAULT 1,
        CreatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_Branches_CountryId ON Branches(CountryId);
    PRINT 'Tabla Branches creada.';
END
GO

-- ============================================================
--  3. USUARIOS
--
--  CK_Users_RoleScope: refleja a nivel de motor las mismas reglas que la
--  capa de aplicación valida en el login:
--    * guardia / jefe_operaciones / admin  → requieren BranchId
--    * admin_pais                          → requiere CountryId, sin BranchId
--    * admin_global                        → sin BranchId ni CountryId
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
BEGIN
    CREATE TABLE Users (
        Id              INT             IDENTITY(1,1)   PRIMARY KEY,
        Username        NVARCHAR(100)   NOT NULL UNIQUE,
        FullName        NVARCHAR(200)   NOT NULL,
        Role            NVARCHAR(30)    NOT NULL
                            CHECK(Role IN (
                                'guardia',
                                'jefe_operaciones',
                                'admin',
                                'admin_pais',
                                'admin_global'
                            )),
        BranchId        INT             NULL REFERENCES Branches(Id),
        CountryId       INT             NULL REFERENCES Countries(Id),  -- admin_pais: país directo sin requerir sucursal
        Active          BIT             NOT NULL DEFAULT 1,
        PasswordHash    NVARCHAR(255)   NOT NULL,
        LastLogin       DATETIME2       NULL,
        CreatedAt       DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_Users_RoleScope CHECK (
               (Role IN ('guardia','jefe_operaciones','admin') AND BranchId IS NOT NULL)
            OR (Role = 'admin_pais'   AND CountryId IS NOT NULL AND BranchId IS NULL)
            OR (Role = 'admin_global' AND BranchId IS NULL AND CountryId IS NULL)
        )
    );
    CREATE INDEX IX_Users_BranchId  ON Users(BranchId);
    CREATE INDEX IX_Users_CountryId ON Users(CountryId);
    CREATE INDEX IX_Users_Role      ON Users(Role);
    PRINT 'Tabla Users creada.';
END
GO

-- ============================================================
--  4. CONDUCTORES
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Drivers')
BEGIN
    CREATE TABLE Drivers (
        Id          INT             IDENTITY(1,1)   PRIMARY KEY,
        BranchId    INT             NOT NULL REFERENCES Branches(Id),
        Name        NVARCHAR(200)   NOT NULL,
        Department  NVARCHAR(150)   NULL,
        Active      BIT             NOT NULL DEFAULT 1,
        CreatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_Drivers_BranchId ON Drivers(BranchId);
    PRINT 'Tabla Drivers creada.';
END
GO

-- ============================================================
--  5. ESTADOS ESPECIALES DE VEHÍCULOS (v2.2)
--
--  Se crea ANTES de Vehicles porque Vehicles.CurrentStatus tiene FK a
--  VehicleStatusTypes([Key]).
--
--  IsSystem = 1: seeded por defecto, no eliminables (solo desactivables).
--  CountryId NULL = global (visible a todos los países).
--  CountryId set  = exclusivo del país indicado.
--
--  El estado base 'active' (en circulación) también vive aquí como tipo de
--  sistema, para que el dominio de Vehicles.CurrentStatus quede cerrado por
--  FK. La aplicación lo excluye de los listados seleccionables.
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VehicleStatusTypes')
BEGIN
    CREATE TABLE VehicleStatusTypes (
        Id          INT             IDENTITY(1,1)   PRIMARY KEY,
        [Key]       NVARCHAR(50)    NOT NULL,           -- slug único: 'workshop', 'abroad', etc.
        LabelEs     NVARCHAR(100)   NOT NULL,
        Color       NVARCHAR(30)    NOT NULL DEFAULT 'slate',  -- clave de paleta frontend
        CountryId   INT             NULL REFERENCES Countries(Id) ON DELETE SET NULL,
        IsSystem    BIT             NOT NULL DEFAULT 0,
        Active      BIT             NOT NULL DEFAULT 1,
        SortOrder   INT             NOT NULL DEFAULT 0,
        CreatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_VehicleStatusTypes_Key UNIQUE ([Key])
    );
    PRINT 'Tabla VehicleStatusTypes creada.';
END
GO

-- Estado base + estados especiales de sistema (no eliminables).
-- 'active' debe existir ANTES de crear Vehicles (FK + DEFAULT 'active').
IF NOT EXISTS (SELECT 1 FROM VehicleStatusTypes WHERE [Key] = 'active')
    INSERT INTO VehicleStatusTypes ([Key], LabelEs, Color, IsSystem, SortOrder)
    VALUES ('active', 'En circulación', 'emerald', 1, 0);

IF NOT EXISTS (SELECT 1 FROM VehicleStatusTypes WHERE [Key] = 'workshop')
    INSERT INTO VehicleStatusTypes ([Key], LabelEs, Color, IsSystem, SortOrder)
    VALUES ('workshop', 'En taller', 'blue', 1, 1);

IF NOT EXISTS (SELECT 1 FROM VehicleStatusTypes WHERE [Key] = 'night_service')
    INSERT INTO VehicleStatusTypes ([Key], LabelEs, Color, IsSystem, SortOrder)
    VALUES ('night_service', 'Servicio nocturno', 'violet', 1, 2);

IF NOT EXISTS (SELECT 1 FROM VehicleStatusTypes WHERE [Key] = 'abroad')
    INSERT INTO VehicleStatusTypes ([Key], LabelEs, Color, IsSystem, SortOrder)
    VALUES ('abroad', 'Fuera del país', 'indigo', 1, 3);

IF NOT EXISTS (SELECT 1 FROM VehicleStatusTypes WHERE [Key] = 'special_authorization')
    INSERT INTO VehicleStatusTypes ([Key], LabelEs, Color, IsSystem, SortOrder)
    VALUES ('special_authorization', 'Autorización especial', 'cyan', 1, 4);
GO

-- ============================================================
--  6. VEHÍCULOS
--
--  CurrentStatus = estado persistente del vehículo (v2.0), cerrado por FK a
--  VehicleStatusTypes([Key]). 'active' = en circulación normal.
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Vehicles')
BEGIN
    CREATE TABLE Vehicles (
        Id                  INT             IDENTITY(1,1)   PRIMARY KEY,
        BranchId            INT             NOT NULL REFERENCES Branches(Id),
        Plate               NVARCHAR(20)    NOT NULL,
        VehicleType         NVARCHAR(80)    NULL,
        Brand               NVARCHAR(80)    NULL,
        Model               NVARCHAR(80)    NULL,
        Year                SMALLINT        NULL,
        ChassisNumber       NVARCHAR(50)    NULL,
        Vin                 NVARCHAR(17)    NULL,
        EngineNumber        NVARCHAR(50)    NULL,
        Active              BIT             NOT NULL DEFAULT 1,
        Notes               NVARCHAR(500)   NULL,
        InitialMileage      INT             NOT NULL DEFAULT 0,
        LastMileage         INT             NOT NULL DEFAULT 0,
        LastInspectionDate  DATETIME2       NULL,
        HasOpenIssues       BIT             NOT NULL DEFAULT 0,
        -- Estado persistente: 'active' o cualquier Key de VehicleStatusTypes
        CurrentStatus               NVARCHAR(50)    NOT NULL DEFAULT 'active'
                                        REFERENCES VehicleStatusTypes([Key]),
        CurrentStatusReason         NVARCHAR(500)   NULL,
        CurrentStatusExpectedReturn DATETIME2       NULL,
        CurrentStatusSince          DATETIME2       NULL,
        CurrentStatusById           INT             NULL REFERENCES Users(Id),
        CreatedAt           DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt           DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_Vehicles_Plate_Branch UNIQUE (Plate, BranchId)
    );
    CREATE INDEX IX_Vehicles_BranchId ON Vehicles(BranchId);
    CREATE INDEX IX_Vehicles_Plate    ON Vehicles(Plate);
    CREATE INDEX IX_Vehicles_Status   ON Vehicles(BranchId, CurrentStatus);
    -- Unicidad real de identificadores físicos (solo cuando están presentes).
    CREATE UNIQUE INDEX UX_Vehicles_Vin     ON Vehicles(Vin)           WHERE Vin           IS NOT NULL;
    CREATE UNIQUE INDEX UX_Vehicles_Chassis ON Vehicles(ChassisNumber) WHERE ChassisNumber IS NOT NULL;
    CREATE UNIQUE INDEX UX_Vehicles_Engine  ON Vehicles(EngineNumber)  WHERE EngineNumber  IS NOT NULL;
    PRINT 'Tabla Vehicles creada.';
END
GO

-- ------------------------------------------------------------
--  Bitácora de cambios de estado del vehículo (auditoría)
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VehicleStatusLog')
BEGIN
    CREATE TABLE VehicleStatusLog (
        Id                  INT             IDENTITY(1,1)   PRIMARY KEY,
        VehicleId           INT             NOT NULL REFERENCES Vehicles(Id),
        OldStatus           NVARCHAR(50)    NULL,   -- snapshot histórico (sin FK: el tipo puede cambiar/borrarse)
        NewStatus           NVARCHAR(50)    NOT NULL,
        Reason              NVARCHAR(500)   NULL,
        ExpectedReturnDate  DATETIME2       NULL,
        ChangedById         INT             NULL REFERENCES Users(Id),
        ChangedAt           DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_VehicleStatusLog_VehicleId ON VehicleStatusLog(VehicleId);
    PRINT 'Tabla VehicleStatusLog creada.';
END
GO

-- ============================================================
--  7. INSPECCIONES  (modelo stream puro — la inspección ES el evento)
--
--  Snapshots intencionales (Plate, GuardName): congelan el valor en el
--  momento del evento — correcto en un modelo de auditoría.
--  Autoría relacional: GuardId (FK), CreatedById (FK), ModifiedById (FK).
--  AuthorizedBy se mantiene como texto libre (puede ser un tercero externo).
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Inspections')
BEGIN
    CREATE TABLE Inspections (
        Id                          INT             IDENTITY(1,1)   PRIMARY KEY,
        BranchId                    INT             NOT NULL REFERENCES Branches(Id),
        VehicleId                   INT             NOT NULL REFERENCES Vehicles(Id),
        Plate                       NVARCHAR(20)    NOT NULL,
        LocalDate                   DATE            NOT NULL,
        Shift                       NVARCHAR(20)    NOT NULL
                                        CHECK(Shift IN ('morning','afternoon','night')),
        GuardId                     INT             NOT NULL REFERENCES Users(Id),
        GuardName                   NVARCHAR(200)   NOT NULL,
        FinalDriverId               INT             NULL REFERENCES Drivers(Id),
        FinalDriverNameManual       NVARCHAR(200)   NULL,
        ReturnStatus                NVARCHAR(30)    NOT NULL DEFAULT 'received'
                                        CHECK(ReturnStatus IN (
                                            'received','not_returned','never_left','other'
                                        )),
        InspectionStatus            NVARCHAR(30)    NOT NULL DEFAULT 'reviewed_ok'
                                        CHECK(InspectionStatus IN (
                                            'reviewed_ok','reviewed_observation',
                                            'serious_issue','not_returned','other'
                                        )),
        AuthorizedBy                NVARCHAR(200)   NULL,
        ExpectedReturnDate          DATETIME2       NULL,
        Mileage                     INT             NULL,
        PreviousMileage             INT             NOT NULL DEFAULT 0,
        MileageDifference           INT             NULL,
        MileageWarningType          NVARCHAR(30)    NOT NULL DEFAULT 'none'
                                        CHECK(MileageWarningType IN (
                                            'none','lower_than_previous','unusually_high'
                                        )),
        MileageWarningConfirmed     BIT             NOT NULL DEFAULT 0,
        MileageWarningObservation   NVARCHAR(500)   NULL,
        FuelLevel                   NVARCHAR(20)    NULL
                                        CHECK(FuelLevel IN (
                                            'empty','quarter','half','three_quarters','full'
                                        )),
        CleanlinessStatus           NVARCHAR(20)    NULL
                                        CHECK(CleanlinessStatus IN (
                                            'clean','acceptable','dirty','very_dirty'
                                        )),
        ToolsGeneralStatus          NVARCHAR(20)    NULL
                                        CHECK(ToolsGeneralStatus IN (
                                            'ok','missing','damaged','not_applicable'
                                        )),
        ExteriorGeneralStatus       NVARCHAR(20)    NULL
                                        CHECK(ExteriorGeneralStatus IN ('ok','observed','damaged')),
        InteriorGeneralStatus       NVARCHAR(20)    NULL
                                        CHECK(InteriorGeneralStatus IN ('ok','observed','damaged')),
        GeneralObservation          NVARCHAR(1000)  NULL,
        HasNewIssue                 BIT             NOT NULL DEFAULT 0,
        HasPhotos                   BIT             NOT NULL DEFAULT 0,
        CreatedById                 INT             NULL REFERENCES Users(Id),
        CreatedAt                   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt                   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        -- Sellado por cambio de turno
        ModifiedAfterSeal           BIT             NOT NULL DEFAULT 0,
        ModifiedById                INT             NULL REFERENCES Users(Id),
        ModifiedReason              NVARCHAR(500)   NULL,
        -- Dirección del evento (v2.1): 'entry' hoy; 'exit' cuando se implemente salida
        Direction                   NVARCHAR(10)    NOT NULL DEFAULT 'entry'
                                        CHECK(Direction IN ('entry', 'exit')),
        -- Ciclo de vida (v2.2): 'draft' = borrador en captura, 'final' = registrado.
        -- DEFAULT 'final' preserva todo el comportamiento previo: las rutas de
        -- escritura que no lo especifican producen registros finales. Solo la
        -- inspección completa de recepción usa el flujo borrador→preview→final.
        LifecycleStatus             NVARCHAR(10)    NOT NULL DEFAULT 'final'
                                        CHECK(LifecycleStatus IN ('draft', 'final'))
    );
    CREATE INDEX IX_Inspections_Branch_Date_Shift ON Inspections(BranchId, LocalDate, Shift);
    CREATE INDEX IX_Inspections_Vehicle_Date      ON Inspections(VehicleId, LocalDate);
    CREATE INDEX IX_Inspections_VehicleId         ON Inspections(VehicleId);
    CREATE INDEX IX_Inspections_Status            ON Inspections(InspectionStatus);
    -- Índice único de bucket: 1 entry + 1 exit por vehículo/turno como máximo
    CREATE UNIQUE INDEX UX_Inspections_Bucket
        ON Inspections (BranchId, VehicleId, LocalDate, Shift, Direction);
    -- Índice filtrado para listar borradores pendientes en el dashboard
    CREATE INDEX IX_Inspections_Draft
        ON Inspections (BranchId, LocalDate) WHERE LifecycleStatus = 'draft';
    PRINT 'Tabla Inspections creada.';
END
GO

-- Auto-sanación para bases creadas ANTES de la v2.2 (idempotente): el bloque
-- CREATE TABLE de arriba se salta si Inspections ya existe, así que la columna
-- LifecycleStatus y su índice filtrado se aseguran aquí por separado. Necesario
-- porque vw_InspectionsFull (más abajo) referencia esta columna en su WHERE.
IF COL_LENGTH('dbo.Inspections', 'LifecycleStatus') IS NULL
    ALTER TABLE dbo.Inspections ADD LifecycleStatus NVARCHAR(10) NOT NULL
        CONSTRAINT DF_Inspections_LifecycleStatus DEFAULT 'final'
        CONSTRAINT CK_Inspections_LifecycleStatus CHECK (LifecycleStatus IN ('draft', 'final'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Inspections_Draft' AND object_id = OBJECT_ID('dbo.Inspections'))
    CREATE INDEX IX_Inspections_Draft ON dbo.Inspections (BranchId, LocalDate) WHERE LifecycleStatus = 'draft';
GO

-- ============================================================
--  8. PROBLEMAS ABIERTOS (OPEN ISSUES)
--
--  Las fotos del problema viven en la tabla Photos (Photos.OpenIssueId),
--  fuente única de verdad. Ya no hay columna PhotoUrls.
--  DetectedBy se conserva como texto (etiqueta mostrada en la UI).
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OpenIssues')
BEGIN
    CREATE TABLE OpenIssues (
        Id                  INT             IDENTITY(1,1)   PRIMARY KEY,
        VehicleId           INT             NOT NULL REFERENCES Vehicles(Id),
        Plate               NVARCHAR(20)    NOT NULL,
        InspectionId        INT             NULL REFERENCES Inspections(Id),
        IssueType           NVARCHAR(40)    NULL
                                CHECK(IssueType IN (
                                    'damage','missing_tool',
                                    'cleanliness_problem','documentation_problem','other'
                                )),
        Category            NVARCHAR(100)   NULL,
        Description         NVARCHAR(1000)  NULL,
        Severity            NVARCHAR(10)    NOT NULL DEFAULT 'medium'
                                CHECK(Severity IN ('low','medium','high')),
        Status              NVARCHAR(20)    NOT NULL DEFAULT 'open'
                                CHECK(Status IN ('open','in_process','resolved','dismissed')),
        DetectedBy          NVARCHAR(200)   NULL,
        DetectedAt          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        MaintenanceAction   NVARCHAR(500)   NULL,
        ClosedById          INT             NULL REFERENCES Users(Id),
        ClosedAt            DATETIME2       NULL,
        ClosingObservation  NVARCHAR(500)   NULL
    );
    CREATE INDEX IX_OpenIssues_VehicleId ON OpenIssues(VehicleId);
    CREATE INDEX IX_OpenIssues_Status    ON OpenIssues(Status);
    PRINT 'Tabla OpenIssues creada.';
END
GO

-- ============================================================
--  9. FOTOS
--
--  Una foto pertenece a una inspección y/o a un problema abierto.
--  CK_Photos_Parent garantiza que tenga al menos un padre.
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Photos')
BEGIN
    CREATE TABLE Photos (
        Id              INT             IDENTITY(1,1)   PRIMARY KEY,
        InspectionId    INT             NULL REFERENCES Inspections(Id),
        OpenIssueId     INT             NULL REFERENCES OpenIssues(Id),
        VehicleId       INT             NOT NULL REFERENCES Vehicles(Id),
        Plate           NVARCHAR(20)    NOT NULL,
        PhotoType       NVARCHAR(30)    NULL
                            CHECK(PhotoType IN (
                                'odometer','exterior_damage','interior_damage',
                                'missing_tool','cleanliness','other','non_return_evidence'
                            )),
        FileName        NVARCHAR(255)   NOT NULL,
        StoragePath     NVARCHAR(500)   NOT NULL,
        InternalUrl     NVARCHAR(500)   NULL,
        UploadedById    INT             NULL REFERENCES Users(Id),
        UploadedAt      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_Photos_Parent CHECK (InspectionId IS NOT NULL OR OpenIssueId IS NOT NULL)
    );
    CREATE INDEX IX_Photos_InspectionId ON Photos(InspectionId);
    CREATE INDEX IX_Photos_OpenIssueId  ON Photos(OpenIssueId);
    CREATE INDEX IX_Photos_VehicleId    ON Photos(VehicleId);
    PRINT 'Tabla Photos creada.';
END
GO

-- ============================================================
--  10. AUDITORÍA
--
--  UserId con FK a Users(Id). UserName se conserva como snapshot legible.
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AuditLogs')
BEGIN
    CREATE TABLE AuditLogs (
        Id          INT             IDENTITY(1,1)   PRIMARY KEY,
        UserId      INT             NULL REFERENCES Users(Id),
        UserName    NVARCHAR(200)   NULL,
        BranchId    INT             NULL REFERENCES Branches(Id),
        CountryId   INT             NULL REFERENCES Countries(Id),
        Action      NVARCHAR(100)   NULL,
        Entity      NVARCHAR(100)   NULL,
        EntityId    NVARCHAR(50)    NULL,
        OldValue    NVARCHAR(MAX)   NULL,
        NewValue    NVARCHAR(MAX)   NULL,
        Reason      NVARCHAR(500)   NULL,
        IpAddress   NVARCHAR(50)    NULL,
        Timestamp   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_AuditLogs_Entity    ON AuditLogs(Entity, EntityId);
    CREATE INDEX IX_AuditLogs_BranchId  ON AuditLogs(BranchId);
    CREATE INDEX IX_AuditLogs_CountryId ON AuditLogs(CountryId);
    CREATE INDEX IX_AuditLogs_Timestamp ON AuditLogs(Timestamp);
    CREATE INDEX IX_AuditLogs_UserId    ON AuditLogs(UserId);
    PRINT 'Tabla AuditLogs creada.';
END
GO

-- Auto-sanación para bases creadas ANTES de añadir CountryId (idempotente):
-- el bloque CREATE TABLE de arriba se salta si AuditLogs ya existe, así que la
-- columna y su índice se aseguran aquí por separado.
IF COL_LENGTH('dbo.AuditLogs', 'CountryId') IS NULL
    ALTER TABLE dbo.AuditLogs ADD CountryId INT NULL REFERENCES Countries(Id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLogs_CountryId' AND object_id = OBJECT_ID('dbo.AuditLogs'))
    CREATE INDEX IX_AuditLogs_CountryId ON dbo.AuditLogs(CountryId);
GO

-- ============================================================
--  11. CONFIGURACIÓN — cascada global → país → sucursal
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Settings')
BEGIN
    CREATE TABLE Settings (
        Id          INT             IDENTITY(1,1)   PRIMARY KEY,
        BranchId    INT             NULL REFERENCES Branches(Id),
        CountryId   INT             NULL REFERENCES Countries(Id),
        [Key]       NVARCHAR(100)   NOT NULL,
        Value       NVARCHAR(500)   NOT NULL,
        CONSTRAINT UQ_Settings_Scope_Key UNIQUE (BranchId, CountryId, [Key])
    );
    PRINT 'Tabla Settings creada.';
END
GO

-- ============================================================
--  12. DATOS INICIALES
-- ============================================================

-- Países
IF NOT EXISTS (SELECT 1 FROM Countries WHERE Code = 'PA')
    INSERT INTO Countries (Code, Name, Timezone) VALUES ('PA', 'Panamá',      'America/Panama');
IF NOT EXISTS (SELECT 1 FROM Countries WHERE Code = 'GT')
    INSERT INTO Countries (Code, Name, Timezone) VALUES ('GT', 'Guatemala',   'America/Guatemala');
IF NOT EXISTS (SELECT 1 FROM Countries WHERE Code = 'SV')
    INSERT INTO Countries (Code, Name, Timezone) VALUES ('SV', 'El Salvador', 'America/El_Salvador');
IF NOT EXISTS (SELECT 1 FROM Countries WHERE Code = 'NI')
    INSERT INTO Countries (Code, Name, Timezone) VALUES ('NI', 'Nicaragua',   'America/Managua');
GO

IF EXISTS (SELECT 1 FROM Countries WHERE Timezone IS NULL OR LTRIM(RTRIM(Timezone)) = '')
    RAISERROR('Hay paises sin Timezone IANA. Corregir antes de registrar inspecciones.', 16, 1);
GO

-- Sucursales de ejemplo
IF NOT EXISTS (SELECT 1 FROM Branches WHERE Code = 'PA-CENTRAL')
    INSERT INTO Branches (CountryId, Code, Name)
    SELECT Id, 'PA-CENTRAL', 'Panama - Sede Central' FROM Countries WHERE Code = 'PA';

IF NOT EXISTS (SELECT 1 FROM Branches WHERE Code = 'GT-CENTRAL')
    INSERT INTO Branches (CountryId, Code, Name)
    SELECT Id, 'GT-CENTRAL', 'Guatemala - Sede Central' FROM Countries WHERE Code = 'GT';

IF NOT EXISTS (SELECT 1 FROM Branches WHERE Code = 'SV-CENTRAL')
    INSERT INTO Branches (CountryId, Code, Name)
    SELECT Id, 'SV-CENTRAL', 'El Salvador - Zaragoza' FROM Countries WHERE Code = 'SV';

-- Auto-sanación (idempotente): las bases creadas antes del rename a "Zaragoza"
-- conservan el nombre viejo ("El Salvador - Sede Central") porque el INSERT de
-- arriba se salta cuando la sucursal ya existe. Forzamos el nombre canónico.
UPDATE Branches SET Name = 'El Salvador - Zaragoza'
WHERE Code = 'SV-CENTRAL' AND Name <> 'El Salvador - Zaragoza';

IF NOT EXISTS (SELECT 1 FROM Branches WHERE Code = 'NI-CENTRAL')
    INSERT INTO Branches (CountryId, Code, Name)
    SELECT Id, 'NI-CENTRAL', 'Nicaragua - Sede Central' FROM Countries WHERE Code = 'NI';
GO

-- ============================================================
--  13. USUARIO ADMIN GLOBAL INICIAL
--  IMPORTANTE: Cambiar el PasswordHash por el hash real (bcrypt). PIN: 1234
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM Users WHERE Username = 'admin')
BEGIN
    INSERT INTO Users (Username, FullName, Role, BranchId, Active, PasswordHash)
    VALUES (
        'admin',
        'Administrador Global',
        'admin_global',
        NULL,
        1,
        '$2a$12$placeholderHashCambiarPorHashRealDeBcrypt'
    );
    PRINT 'Usuario admin_global creado. CAMBIAR EL HASH DE CONTRASEÑA.';
END
GO

-- ============================================================
--  14. VISTAS ÚTILES
-- ============================================================

CREATE OR ALTER VIEW vw_InspectionsFull AS
SELECT
    i.Id,
    i.LocalDate,
    i.Shift,
    i.Plate,
    i.GuardName,
    i.ReturnStatus,
    i.InspectionStatus,
    i.Mileage,
    i.HasNewIssue,
    i.CreatedAt,
    b.Id     AS BranchId,
    b.Name   AS BranchName,
    b.Code   AS BranchCode,
    c.Name   AS CountryName,
    c.Code   AS CountryCode
FROM Inspections i
JOIN Branches b ON i.BranchId = b.Id
JOIN Countries c ON b.CountryId = c.Id
WHERE i.LifecycleStatus = 'final';
GO

CREATE OR ALTER VIEW vw_VehiclesFull AS
SELECT
    v.Id,
    v.Plate,
    v.VehicleType,
    v.Brand,
    v.Model,
    v.Year,
    v.Active,
    v.LastMileage,
    v.LastInspectionDate,
    v.HasOpenIssues,
    v.CurrentStatus,
    v.CurrentStatusExpectedReturn,
    b.Name   AS BranchName,
    b.Code   AS BranchCode,
    c.Name   AS CountryName,
    c.Code   AS CountryCode
FROM Vehicles v
JOIN Branches b ON v.BranchId = b.Id
JOIN Countries c ON b.CountryId = c.Id;
GO

CREATE OR ALTER VIEW vw_OpenIssuesFull AS
SELECT
    oi.Id,
    oi.Plate,
    oi.IssueType,
    oi.Description,
    oi.Severity,
    oi.Status,
    oi.DetectedBy,
    oi.DetectedAt,
    oi.MaintenanceAction,
    oi.ClosedAt,
    b.Name   AS BranchName,
    c.Name   AS CountryName,
    c.Code   AS CountryCode
FROM OpenIssues oi
JOIN Vehicles v  ON oi.VehicleId = v.Id
JOIN Branches b  ON v.BranchId = b.Id
JOIN Countries c ON b.CountryId = c.Id;
GO

-- ============================================================
--  15. ROW-LEVEL SECURITY (RLS)
--
--  Requisito de producción: el usuario de aplicación NO debe ser db_owner.
--  Crear un usuario dedicado ANTES de ejecutar la app en producción:
--
--    CREATE LOGIN app_user WITH PASSWORD = '...';
--    CREATE USER  app_user FOR LOGIN app_user;
--    ALTER ROLE db_datareader ADD MEMBER app_user;
--    ALTER ROLE db_datawriter ADD MEMBER app_user;
--    GRANT EXECUTE ON OBJECT::sys.sp_set_session_context TO app_user;
--
--  Si la app corre como db_owner / sa, SQL Server ignora todas las políticas.
--
--  SESSION_CONTEXT que el backend inicializa en cada petición autenticada:
--    CtxBranchId  (INT)  — sucursal del usuario, NULL si no aplica
--    CtxCountryId (INT)  — país del usuario, NULL si no aplica
--    CtxIsGlobal  (BIT)  — 1 sólo para admin_global
--
--  Tablas protegidas:
--    Vehicles, Inspections, Drivers      → fn_BranchFilter(BranchId)
--    OpenIssues, Photos, VehicleStatusLog → fn_VehicleFilter(VehicleId)
--
--  Tablas excluidas (el control de capa de app es suficiente):
--    Users, Branches, Countries, Settings, VehicleStatusTypes, AuditLogs
-- ============================================================

-- ── Schema de seguridad ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'Security')
    EXEC('CREATE SCHEMA Security');
GO

-- ── Re-ejecutabilidad: soltar las políticas ANTES de (re)crear las funciones ──
-- Las funciones RLS son WITH SCHEMABINDING y están referenciadas por las
-- SECURITY POLICY. SQL Server prohíbe ALTER de una función schemabound mientras
-- una política la referencia (error 3729). En una RE-EJECUCIÓN de este script,
-- el "CREATE OR ALTER FUNCTION" de abajo intentaría ALTER y fallaría con:
--   "Cannot ALTER 'Security.fn_BranchFilter' because it is being referenced
--    by object 'VehiclesPolicy'."
-- Se sueltan aquí (idempotente: IF EXISTS) y los bloques IF NOT EXISTS de más
-- abajo las recrean. En la PRIMERA ejecución aún no existen → no-op.
DROP SECURITY POLICY IF EXISTS Security.VehiclesPolicy;
DROP SECURITY POLICY IF EXISTS Security.InspectionsPolicy;
DROP SECURITY POLICY IF EXISTS Security.DriversPolicy;
DROP SECURITY POLICY IF EXISTS Security.OpenIssuesPolicy;
DROP SECURITY POLICY IF EXISTS Security.PhotosPolicy;
DROP SECURITY POLICY IF EXISTS Security.VehicleStatusLogPolicy;
GO

-- ── fn_BranchFilter ──────────────────────────────────────────
-- Para tablas con columna BranchId directa.
-- Permite la fila si:
--   (a) CtxIsGlobal = 1  → admin_global ve todo
--   (b) BranchId = CtxBranchId  → usuario de esa sucursal
--   (c) La sucursal pertenece al país CtxCountryId  → admin_pais
-- Sin SESSION_CONTEXT inicializado, las tres condiciones devuelven NULL/false
-- → la fila es filtrada. Sin contexto = sin acceso.
CREATE OR ALTER FUNCTION Security.fn_BranchFilter(@BranchId INT)
RETURNS TABLE
WITH SCHEMABINDING
AS RETURN
    SELECT 1 AS ok
    WHERE
        CAST(SESSION_CONTEXT(N'CtxIsGlobal')  AS BIT) = CAST(1 AS BIT)
        OR CAST(SESSION_CONTEXT(N'CtxBranchId') AS INT) = @BranchId
        OR EXISTS (
            SELECT 1
            FROM   dbo.Branches b
            WHERE  b.Id = @BranchId
            AND    b.CountryId = CAST(SESSION_CONTEXT(N'CtxCountryId') AS INT)
        );
GO

-- ── fn_VehicleFilter ─────────────────────────────────────────
-- Para tablas que referencian VehicleId en lugar de BranchId directo
-- (OpenIssues, Photos, VehicleStatusLog).
-- Navega VehicleId → Vehicles.BranchId y aplica las mismas condiciones.
CREATE OR ALTER FUNCTION Security.fn_VehicleFilter(@VehicleId INT)
RETURNS TABLE
WITH SCHEMABINDING
AS RETURN
    SELECT 1 AS ok
    WHERE
        CAST(SESSION_CONTEXT(N'CtxIsGlobal') AS BIT) = CAST(1 AS BIT)
        OR EXISTS (
            SELECT 1
            FROM   dbo.Vehicles v
            WHERE  v.Id = @VehicleId
            AND    (
                v.BranchId = CAST(SESSION_CONTEXT(N'CtxBranchId') AS INT)
                OR EXISTS (
                    SELECT 1
                    FROM   dbo.Branches b
                    WHERE  b.Id = v.BranchId
                    AND    b.CountryId = CAST(SESSION_CONTEXT(N'CtxCountryId') AS INT)
                )
            )
        );
GO

-- ── Políticas para tablas con BranchId directo ───────────────

IF NOT EXISTS (SELECT 1 FROM sys.security_policies WHERE name = 'VehiclesPolicy'    AND schema_id = SCHEMA_ID('Security'))
BEGIN
    CREATE SECURITY POLICY Security.VehiclesPolicy
        ADD FILTER PREDICATE Security.fn_BranchFilter(BranchId) ON dbo.Vehicles,
        ADD BLOCK  PREDICATE Security.fn_BranchFilter(BranchId) ON dbo.Vehicles AFTER INSERT,
        ADD BLOCK  PREDICATE Security.fn_BranchFilter(BranchId) ON dbo.Vehicles AFTER UPDATE
    WITH (STATE = ON);
    PRINT 'RLS: Security.VehiclesPolicy creada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.security_policies WHERE name = 'InspectionsPolicy' AND schema_id = SCHEMA_ID('Security'))
BEGIN
    CREATE SECURITY POLICY Security.InspectionsPolicy
        ADD FILTER PREDICATE Security.fn_BranchFilter(BranchId) ON dbo.Inspections,
        ADD BLOCK  PREDICATE Security.fn_BranchFilter(BranchId) ON dbo.Inspections AFTER INSERT,
        ADD BLOCK  PREDICATE Security.fn_BranchFilter(BranchId) ON dbo.Inspections AFTER UPDATE
    WITH (STATE = ON);
    PRINT 'RLS: Security.InspectionsPolicy creada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.security_policies WHERE name = 'DriversPolicy'     AND schema_id = SCHEMA_ID('Security'))
BEGIN
    CREATE SECURITY POLICY Security.DriversPolicy
        ADD FILTER PREDICATE Security.fn_BranchFilter(BranchId) ON dbo.Drivers,
        ADD BLOCK  PREDICATE Security.fn_BranchFilter(BranchId) ON dbo.Drivers AFTER INSERT,
        ADD BLOCK  PREDICATE Security.fn_BranchFilter(BranchId) ON dbo.Drivers AFTER UPDATE
    WITH (STATE = ON);
    PRINT 'RLS: Security.DriversPolicy creada.';
END
GO

-- ── Políticas para tablas con VehicleId indirecto ────────────

IF NOT EXISTS (SELECT 1 FROM sys.security_policies WHERE name = 'OpenIssuesPolicy'       AND schema_id = SCHEMA_ID('Security'))
BEGIN
    CREATE SECURITY POLICY Security.OpenIssuesPolicy
        ADD FILTER PREDICATE Security.fn_VehicleFilter(VehicleId) ON dbo.OpenIssues,
        ADD BLOCK  PREDICATE Security.fn_VehicleFilter(VehicleId) ON dbo.OpenIssues AFTER INSERT,
        ADD BLOCK  PREDICATE Security.fn_VehicleFilter(VehicleId) ON dbo.OpenIssues AFTER UPDATE
    WITH (STATE = ON);
    PRINT 'RLS: Security.OpenIssuesPolicy creada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.security_policies WHERE name = 'PhotosPolicy'           AND schema_id = SCHEMA_ID('Security'))
BEGIN
    CREATE SECURITY POLICY Security.PhotosPolicy
        ADD FILTER PREDICATE Security.fn_VehicleFilter(VehicleId) ON dbo.Photos,
        ADD BLOCK  PREDICATE Security.fn_VehicleFilter(VehicleId) ON dbo.Photos AFTER INSERT,
        ADD BLOCK  PREDICATE Security.fn_VehicleFilter(VehicleId) ON dbo.Photos AFTER UPDATE
    WITH (STATE = ON);
    PRINT 'RLS: Security.PhotosPolicy creada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.security_policies WHERE name = 'VehicleStatusLogPolicy' AND schema_id = SCHEMA_ID('Security'))
BEGIN
    CREATE SECURITY POLICY Security.VehicleStatusLogPolicy
        ADD FILTER PREDICATE Security.fn_VehicleFilter(VehicleId) ON dbo.VehicleStatusLog,
        ADD BLOCK  PREDICATE Security.fn_VehicleFilter(VehicleId) ON dbo.VehicleStatusLog AFTER INSERT,
        ADD BLOCK  PREDICATE Security.fn_VehicleFilter(VehicleId) ON dbo.VehicleStatusLog AFTER UPDATE
    WITH (STATE = ON);
    PRINT 'RLS: Security.VehicleStatusLogPolicy creada.';
END
GO

-- ── Visibilidad de metadatos RLS para el login de aplicación ─────────────────
-- El self-test de arranque (backend/src/index.ts) cuenta las filas de
-- sys.security_policies habilitadas. Por las reglas de VISIBILIDAD DE METADATOS
-- de SQL Server, un login NO privilegiado (vi_app, sin db_owner/sysadmin) no ve
-- los objetos del esquema Security a menos que tenga VIEW DEFINITION sobre él
-- → contaría 0 políticas y, en producción, el contenedor abortaría (process.exit)
-- aunque las políticas SÍ existan y estén activas.
--
-- Se concede aquí de forma idempotente (GRANT repetido = no-op) y SOLO si el
-- usuario de aplicación ya existe en esta base (lo crea database/create-app-user.sql).
-- Si todavía no existe, este bloque se omite sin error; vuelve a ejecutar este
-- script DESPUÉS de crear el usuario, o usa create-app-user.sql, que también
-- aplica este GRANT. Ajusta el nombre si tu usuario de app difiere de 'vi_app'.
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'vi_app')
BEGIN
    GRANT VIEW DEFINITION ON SCHEMA::Security TO vi_app;
    PRINT 'RLS: concedido VIEW DEFINITION ON SCHEMA::Security a vi_app (visibilidad del self-test).';
END
ELSE
    PRINT 'RLS: el usuario vi_app aun no existe; ejecuta create-app-user.sql para conceder VIEW DEFINITION.';
GO

PRINT '================================================';
PRINT 'Operaciones v3.0 creada correctamente.';
PRINT 'Países cargados: PA, GT, SV, NI';
PRINT 'Estados de vehículo: active + 4 tipos sistema cargados.';
PRINT 'Recuerda: actualizar el PasswordHash del admin';
PRINT 'RLS activo en: Vehicles, Inspections, Drivers,';
PRINT '               OpenIssues, Photos, VehicleStatusLog';
PRINT 'IMPORTANTE: conectar la app como usuario no-db_owner';
PRINT '================================================';
GO
