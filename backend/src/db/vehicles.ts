import sql from 'mssql';
import { getConn } from './connection';
import type { TenantScope, Vehicle, VehicleStatus } from '../types';
import { applyScopeWhere } from './scopeUtils';
import { AppError } from '../middleware/errorHandler';

function isoDate(val: unknown): string {
  return val instanceof Date ? val.toISOString() : val as string;
}

function toVehicle(r: Record<string, unknown>): Vehicle {
  return {
    id:                 String(r.Id),
    branchId:           r.BranchId           as number,
    plate:              r.Plate              as string,
    vehicleType:        (r.VehicleType        as string | null) ?? '',
    brand:              (r.Brand              as string | null) ?? '',
    model:              (r.Model              as string | null) ?? '',
    year:               (r.Year               as number | null) ?? undefined,
    chassisNumber:      (r.ChassisNumber      as string | null) ?? undefined,
    vin:                (r.Vin                as string | null) ?? undefined,
    engineNumber:       (r.EngineNumber       as string | null) ?? undefined,
    active:             r.Active             as boolean,
    notes:              (r.Notes              as string | null) ?? undefined,
    initialMileage:     (r.InitialMileage     as number) ?? 0,
    lastMileage:        (r.LastMileage        as number) ?? 0,
    lastInspectionDate: r.LastInspectionDate != null ? isoDate(r.LastInspectionDate) : undefined,
    hasOpenIssues:      r.HasOpenIssues      as boolean,
    currentStatus:               (r.CurrentStatus as VehicleStatus | null) ?? 'active',
    currentStatusReason:         (r.CurrentStatusReason as string | null) ?? undefined,
    currentStatusExpectedReturn: r.CurrentStatusExpectedReturn != null ? isoDate(r.CurrentStatusExpectedReturn) : undefined,
    currentStatusSince:          r.CurrentStatusSince != null ? isoDate(r.CurrentStatusSince) : undefined,
    currentStatusBy:             r.CurrentStatusById != null ? String(r.CurrentStatusById) : undefined,
    createdAt:          isoDate(r.CreatedAt),
    updatedAt:          isoDate(r.UpdatedAt),
  };
}

export async function getActiveVehicles(scope: TenantScope): Promise<Vehicle[]> {
  const req = getConn();
  const scopeClause = applyScopeWhere(req, scope);
  const result = await req.query(`
    SELECT * FROM Vehicles WHERE Active = 1 AND ${scopeClause} ORDER BY Plate
  `);
  return result.recordset.map(toVehicle);
}

export async function getAllVehicles(scope: TenantScope): Promise<Vehicle[]> {
  const req = getConn();
  const scopeClause = applyScopeWhere(req, scope);
  const result = await req.query(`
    SELECT * FROM Vehicles WHERE ${scopeClause} ORDER BY Plate
  `);
  return result.recordset.map(toVehicle);
}

/**
 * Returns the vehicle by ID, optionally filtered by tenant scope.
 *
 * When `scope` is supplied the SQL WHERE clause includes the scope filter.
 * The function returns `null` when the vehicle does not exist OR when it falls
 * outside the provided scope — callers receive the same 404 in both cases,
 * which prevents IDOR enumeration (a caller cannot distinguish "vehicle
 * doesn't exist" from "vehicle exists but belongs to a different branch").
 *
 * When `scope` is omitted the function performs an unscoped lookup and returns
 * `null` only when the row is missing.  Use this form only in admin mutation
 * handlers that perform their own `assertResourceInScope` check afterwards.
 */
export async function getVehicleById(id: string, scope?: TenantScope): Promise<Vehicle | null> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(id, 10));
  const scopeClause = scope ? `AND ${applyScopeWhere(req, scope)}` : '';
  const result = await req.query(`SELECT * FROM Vehicles WHERE Id = @id ${scopeClause}`);
  return result.recordset[0] ? toVehicle(result.recordset[0]) : null;
}

export async function createVehicle(data: {
  branchId:       number;
  plate:          string;
  vehicleType?:   string;
  brand:          string;
  model:          string;
  year?:          number | null;
  notes?:         string;
  initialMileage?: number;
  chassisNumber?: string;
  vin?:           string;
  engineNumber?:  string;
}): Promise<Vehicle> {
  const req = getConn();
  const now  = new Date().toISOString();
  req.input('branchId',       sql.Int,           data.branchId);
  req.input('plate',          sql.NVarChar(20),  data.plate.toUpperCase());
  req.input('vehicleType',    sql.NVarChar(80),  data.vehicleType ?? '');
  req.input('brand',          sql.NVarChar(80),  data.brand);
  req.input('model',          sql.NVarChar(80),  data.model);
  req.input('year',           sql.SmallInt,      data.year ?? null);
  req.input('chassisNumber',  sql.NVarChar(50),  data.chassisNumber ?? null);
  req.input('vin',            sql.NVarChar(17),  data.vin ?? null);
  req.input('engineNumber',   sql.NVarChar(50),  data.engineNumber ?? null);
  req.input('notes',          sql.NVarChar(500), data.notes ?? '');
  req.input('initialMileage', sql.Int,           data.initialMileage ?? 0);
  req.input('now',            sql.NVarChar(50),  now);
  const result = await req.query(`
    INSERT INTO Vehicles
      (BranchId, Plate, VehicleType, Brand, Model, Year,
       ChassisNumber, Vin, EngineNumber,
       Active, Notes, InitialMileage, LastMileage, HasOpenIssues, CreatedAt, UpdatedAt)
    OUTPUT INSERTED.*
    VALUES
      (@branchId, @plate, @vehicleType, @brand, @model, @year,
       @chassisNumber, @vin, @engineNumber,
       1, @notes, @initialMileage, @initialMileage, 0, @now, @now)
  `);
  return toVehicle(result.recordset[0]);
}

export async function updateVehicle(id: string, data: {
  plate?:       string;
  vehicleType?: string;
  brand?:       string;
  model?:       string;
  year?:        number | null;
  notes?:       string;
  chassisNumber?: string | null;
  vin?:           string | null;
  engineNumber?:  string | null;
}): Promise<void> {
  const req = getConn();
  req.input('id',  sql.Int,          parseInt(id, 10));
  req.input('now', sql.NVarChar(50), new Date().toISOString());

  const set = ['UpdatedAt = @now'];
  if (data.plate       !== undefined) { req.input('plate',       sql.NVarChar(20),  data.plate.toUpperCase()); set.push('Plate = @plate'); }
  if (data.vehicleType !== undefined) { req.input('vehicleType', sql.NVarChar(80),  data.vehicleType);         set.push('VehicleType = @vehicleType'); }
  if (data.brand       !== undefined) { req.input('brand',       sql.NVarChar(80),  data.brand);               set.push('Brand = @brand'); }
  if (data.model       !== undefined) { req.input('model',       sql.NVarChar(80),  data.model);               set.push('Model = @model'); }
  if (data.year        !== undefined) { req.input('year',        sql.SmallInt,      data.year);                set.push('Year = @year'); }
  if (data.chassisNumber !== undefined) { req.input('chassisNumber', sql.NVarChar(50), data.chassisNumber); set.push('ChassisNumber = @chassisNumber'); }
  if (data.vin           !== undefined) { req.input('vin',           sql.NVarChar(17), data.vin);           set.push('Vin = @vin'); }
  if (data.engineNumber  !== undefined) { req.input('engineNumber',  sql.NVarChar(50), data.engineNumber);  set.push('EngineNumber = @engineNumber'); }
  if (data.notes       !== undefined) { req.input('notes',       sql.NVarChar(500), data.notes);               set.push('Notes = @notes'); }

  await req.query(`UPDATE Vehicles SET ${set.join(', ')} WHERE Id = @id`);
}

export async function setVehicleActive(id: string, active: boolean): Promise<void> {
  const req = getConn();
  req.input('id',     sql.Int,          parseInt(id, 10));
  req.input('active', sql.Bit,          active ? 1 : 0);
  req.input('now',    sql.NVarChar(50), new Date().toISOString());
  await req.query(`UPDATE Vehicles SET Active = @active, UpdatedAt = @now WHERE Id = @id`);
}

/**
 * Recalcula LastMileage y LastInspectionDate desde la tabla Inspections,
 * usando la lectura cronológicamente más reciente (CreatedAt DESC).
 *
 * Reemplaza el antiguo updateAfterInspection(mileage) directo.
 *
 * Por qué importa: editar una inspección histórica con el método anterior
 * sobrescribía LastMileage con un valor viejo, corrompiendo el baseline
 * antifraude del odómetro para inspecciones futuras.
 *
 * Este método es auto-sanador: puede llamarse después de cualquier
 * insert/update/delete en Inspections sin riesgo de regresión. Cuando
 * se agreguen registros de salida (Direction='exit'), también participarán
 * del cálculo sin cambios adicionales.
 */
export async function refreshVehicleMileage(vehicleId: string): Promise<void> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(vehicleId, 10));
  await req.query(`
    UPDATE Vehicles
    SET LastMileage = ISNULL((
          SELECT TOP 1 Mileage
          FROM   Inspections
          WHERE  VehicleId = @id AND Mileage IS NOT NULL
          ORDER  BY CreatedAt DESC
        ), LastMileage),
        LastInspectionDate = ISNULL((
          SELECT MAX(CreatedAt)
          FROM   Inspections
          WHERE  VehicleId = @id
        ), LastInspectionDate),
        UpdatedAt = SYSUTCDATETIME()
    WHERE Id = @id
  `);
}

export async function setOpenIssuesFlag(vehicleId: string, hasOpenIssues: boolean): Promise<void> {
  const req = getConn();
  req.input('id',   sql.Int,          parseInt(vehicleId, 10));
  req.input('flag', sql.Bit,          hasOpenIssues ? 1 : 0);
  req.input('now',  sql.NVarChar(50), new Date().toISOString());
  await req.query(`UPDATE Vehicles SET HasOpenIssues = @flag, UpdatedAt = @now WHERE Id = @id`);
}

/**
 * Cambia el estado persistente del vehículo y registra la transición en
 * VehicleStatusLog. Si el estado nuevo es igual al actual no hace nada
 * (devuelve changed:false); devuelve changed:true si cambió.
 *
 * Corre sobre la transacción del request (getConn). La atomicidad
 * vehículo + log la garantiza esa transacción, que hace rollback si el handler
 * falla más adelante. NO abre una transacción propia: hacerlo sobre una segunda
 * conexión mientras el request retiene la suya provocaba un bloqueo mutuo — la
 * 2ª conexión esperaba un lock de fila que la 1ª no liberaba hasta su commit
 * final, y ese commit no ocurría hasta que esta función retornara.
 */
export async function setVehicleStatus(data: {
  vehicleId:          string;
  newStatus:          VehicleStatus;
  reason?:            string;
  expectedReturnDate?: string | null;
  changedBy:          string;
}): Promise<{ changed: boolean; oldStatus: VehicleStatus }> {
  const read = getConn();
  read.input('id', sql.Int, parseInt(data.vehicleId, 10));
  const current = await read.query(`SELECT CurrentStatus FROM Vehicles WHERE Id = @id`);
  if (!current.recordset[0]) throw new AppError(404, 'NOT_FOUND', 'Vehículo no encontrado.');
  const oldStatus = (current.recordset[0].CurrentStatus as VehicleStatus) ?? 'active';

  if (oldStatus === data.newStatus) {
    return { changed: false, oldStatus };
  }

  const now = new Date().toISOString();
  const changedById = parseInt(data.changedBy, 10);
  const byId = Number.isNaN(changedById) ? null : changedById;

  const upd = getConn();
  upd.input('id',        sql.Int,           parseInt(data.vehicleId, 10));
  upd.input('status',    sql.NVarChar(30),  data.newStatus);
  upd.input('reason',    sql.NVarChar(500), data.reason ?? null);
  upd.input('expected',  sql.NVarChar(50),  data.expectedReturnDate ?? null);
  upd.input('by',        sql.Int,           byId);
  upd.input('now',       sql.NVarChar(50),  now);
  await upd.query(`
    UPDATE Vehicles
    SET CurrentStatus = @status,
        CurrentStatusReason = @reason,
        CurrentStatusExpectedReturn = @expected,
        CurrentStatusSince = @now,
        CurrentStatusById = @by,
        UpdatedAt = @now
    WHERE Id = @id
  `);

  const log = getConn();
  log.input('vehicleId', sql.Int,           parseInt(data.vehicleId, 10));
  log.input('oldStatus', sql.NVarChar(30),  oldStatus);
  log.input('newStatus', sql.NVarChar(30),  data.newStatus);
  log.input('reason',    sql.NVarChar(500), data.reason ?? null);
  log.input('expected',  sql.NVarChar(50),  data.expectedReturnDate ?? null);
  log.input('by',        sql.Int,           byId);
  await log.query(`
    INSERT INTO VehicleStatusLog (VehicleId, OldStatus, NewStatus, Reason, ExpectedReturnDate, ChangedById)
    VALUES (@vehicleId, @oldStatus, @newStatus, @reason, @expected, @by)
  `);

  return { changed: true, oldStatus };
}
