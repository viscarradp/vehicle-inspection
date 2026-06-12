import sql from 'mssql';
import { getConn } from './connection';
import { applyScopeWhere } from './scopeUtils';
import type {
  Inspection, ReturnStatus, InspectionStatus, LifecycleStatus, Shift, InspectionDirection,
  FuelLevel, CleanlinessStatus, GeneralStatus, ToolsStatus, MileageWarningType,
  TenantScope,
} from '../types';

function isoDate(val: unknown): string {
  return val instanceof Date ? val.toISOString() : val as string;
}

function dateOnly(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return (val as string).split('T')[0];
}

function toInspection(r: Record<string, unknown>): Inspection {
  return {
    id:                        String(r.Id),
    branchId:                  r.BranchId                     as number,
    vehicleId:                 String(r.VehicleId),
    plate:                     r.Plate                        as string,
    localDate:                 dateOnly(r.LocalDate),
    shift:                     r.Shift                        as Shift,
    direction:                 ((r.Direction as string | null) ?? 'entry') as InspectionDirection,
    guardId:                   String(r.GuardId),
    guardName:                 r.GuardName                    as string,
    finalDriverId:             r.FinalDriverId   != null ? String(r.FinalDriverId)  : undefined,
    finalDriverNameManual:     (r.FinalDriverNameManual       as string | null)      ?? undefined,
    returnStatus:              r.ReturnStatus                 as ReturnStatus,
    status:                    r.InspectionStatus             as InspectionStatus,
    lifecycleStatus:           (r.LifecycleStatus             as LifecycleStatus) ?? 'final',
    authorizedBy:              (r.AuthorizedBy                as string | null)      ?? undefined,
    expectedReturnDate:        r.ExpectedReturnDate != null ? isoDate(r.ExpectedReturnDate) : undefined,
    mileage:                   (r.Mileage                     as number | null)      ?? undefined,
    previousMileage:           (r.PreviousMileage             as number)             ?? 0,
    mileageDifference:         (r.MileageDifference           as number | null)      ?? undefined,
    mileageWarningType:        (r.MileageWarningType          as MileageWarningType) ?? 'none',
    mileageWarningConfirmed:   r.MileageWarningConfirmed      as boolean,
    mileageWarningObservation: (r.MileageWarningObservation   as string | null)      ?? undefined,
    fuelLevel:                 (r.FuelLevel                   as FuelLevel | null)   ?? undefined,
    cleanlinessStatus:         (r.CleanlinessStatus           as CleanlinessStatus | null) ?? undefined,
    toolsGeneralStatus:        (r.ToolsGeneralStatus          as ToolsStatus | null) ?? undefined,
    exteriorGeneralStatus:     (r.ExteriorGeneralStatus       as GeneralStatus | null) ?? undefined,
    interiorGeneralStatus:     (r.InteriorGeneralStatus       as GeneralStatus | null) ?? undefined,
    generalObservation:        (r.GeneralObservation          as string | null)      ?? undefined,
    hasNewIssue:               r.HasNewIssue                  as boolean,
    hasPhotos:                 r.HasPhotos                    as boolean,
    createdBy:                 r.CreatedById != null ? String(r.CreatedById) : '',
    createdAt:                 isoDate(r.CreatedAt),
    updatedAt:                 isoDate(r.UpdatedAt),
    modifiedAfterSeal:         r.ModifiedAfterSeal            as boolean,
    modifiedBy:                r.ModifiedById != null ? String(r.ModifiedById) : undefined,
    modifiedReason:            (r.ModifiedReason              as string | null)      ?? undefined,
  };
}

/** True when SQL Server raises a unique-constraint violation (codes 2627 / 2601). */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { number?: number };
  return e.number === 2627 || e.number === 2601;
}

/**
 * Crea un evento de inspección autocontenido (modelo stream v2.1).
 * Estampado con BranchId + LocalDate + Shift + Direction + GuardId calculados server-side.
 *
 * Race-condition resilient: si dos peticiones simultáneas llegan al mismo bucket
 * (kiosco compartido, doble-tap táctil), la segunda viola UX_Inspections_Bucket.
 * En ese caso se recupera silenciosamente re-leyendo el registro existente y
 * actualizándolo — el resultado es idéntico a un UPDATE desde el primer intento.
 */
export async function createInspection(data: {
  branchId:                  number;
  vehicleId:                 string;
  plate:                     string;
  localDate:                 string;
  shift:                     Shift;
  direction:                 InspectionDirection;
  guardId:                   string;
  guardName:                 string;
  returnStatus:              ReturnStatus;
  inspectionStatus:          InspectionStatus;
  authorizedBy:              string;
  expectedReturnDate:        string;
  finalDriverId:             string | null;
  finalDriverNameManual:     string;
  mileage:                   number | null;
  previousMileage:           number;
  mileageDifference:         number | null;
  mileageWarningType:        MileageWarningType;
  mileageWarningConfirmed:   boolean;
  mileageWarningObservation: string;
  fuelLevel:                 FuelLevel | null;
  cleanlinessStatus:         CleanlinessStatus | null;
  toolsGeneralStatus:        ToolsStatus | null;
  exteriorGeneralStatus:     GeneralStatus | null;
  interiorGeneralStatus:     GeneralStatus | null;
  generalObservation:        string;
  hasNewIssue:               boolean;
  lifecycleStatus:           LifecycleStatus;
  createdBy:                 string;
  now:                       string;
}): Promise<{ id: string }> {
  const req = getConn();
  req.input('branchId',                  sql.Int,            data.branchId);
  req.input('vehicleId',                 sql.Int,            parseInt(data.vehicleId, 10));
  req.input('plate',                     sql.NVarChar(20),   data.plate);
  req.input('localDate',                 sql.Date,           data.localDate);
  req.input('shift',                     sql.NVarChar(20),   data.shift);
  req.input('direction',                 sql.NVarChar(10),   data.direction);
  req.input('guardId',                   sql.Int,            parseInt(data.guardId, 10));
  req.input('guardName',                 sql.NVarChar(200),  data.guardName);
  req.input('returnStatus',              sql.NVarChar(30),   data.returnStatus);
  req.input('inspectionStatus',          sql.NVarChar(30),   data.inspectionStatus);
  req.input('authorizedBy',              sql.NVarChar(200),  data.authorizedBy);
  req.input('expectedReturnDate',        sql.NVarChar(50),   data.expectedReturnDate || null);
  req.input('finalDriverId',             sql.Int,            data.finalDriverId ? parseInt(data.finalDriverId, 10) : null);
  req.input('finalDriverNameManual',     sql.NVarChar(200),  data.finalDriverNameManual);
  req.input('mileage',                   sql.Int,            data.mileage);
  req.input('previousMileage',           sql.Int,            data.previousMileage);
  req.input('mileageDifference',         sql.Int,            data.mileageDifference);
  req.input('mileageWarningType',        sql.NVarChar(30),   data.mileageWarningType);
  req.input('mileageWarningConfirmed',   sql.Bit,            data.mileageWarningConfirmed ? 1 : 0);
  req.input('mileageWarningObservation', sql.NVarChar(500),  data.mileageWarningObservation);
  req.input('fuelLevel',                 sql.NVarChar(20),   data.fuelLevel);
  req.input('cleanlinessStatus',         sql.NVarChar(20),   data.cleanlinessStatus);
  req.input('toolsGeneralStatus',        sql.NVarChar(20),   data.toolsGeneralStatus);
  req.input('exteriorGeneralStatus',     sql.NVarChar(20),   data.exteriorGeneralStatus);
  req.input('interiorGeneralStatus',     sql.NVarChar(20),   data.interiorGeneralStatus);
  req.input('generalObservation',        sql.NVarChar(1000), data.generalObservation);
  req.input('hasNewIssue',               sql.Bit,            data.hasNewIssue ? 1 : 0);
  req.input('lifecycleStatus',           sql.NVarChar(10),   data.lifecycleStatus);
  const createdById = parseInt(data.createdBy, 10);
  req.input('createdById',               sql.Int,            Number.isNaN(createdById) ? null : createdById);
  req.input('now',                       sql.NVarChar(50),   data.now);

  try {
    const result = await req.query(`
      INSERT INTO Inspections (
        BranchId, VehicleId, Plate, LocalDate, Shift, Direction, GuardId, GuardName,
        ReturnStatus, InspectionStatus,
        AuthorizedBy, ExpectedReturnDate, FinalDriverId, FinalDriverNameManual,
        Mileage, PreviousMileage, MileageDifference,
        MileageWarningType, MileageWarningConfirmed, MileageWarningObservation,
        FuelLevel, CleanlinessStatus, ToolsGeneralStatus,
        ExteriorGeneralStatus, InteriorGeneralStatus,
        GeneralObservation, HasNewIssue, HasPhotos, ModifiedAfterSeal,
        LifecycleStatus,
        CreatedById, CreatedAt, UpdatedAt
      )
      OUTPUT INSERTED.Id
      VALUES (
        @branchId, @vehicleId, @plate, @localDate, @shift, @direction, @guardId, @guardName,
        @returnStatus, @inspectionStatus,
        @authorizedBy, @expectedReturnDate, @finalDriverId, @finalDriverNameManual,
        @mileage, @previousMileage, @mileageDifference,
        @mileageWarningType, @mileageWarningConfirmed, @mileageWarningObservation,
        @fuelLevel, @cleanlinessStatus, @toolsGeneralStatus,
        @exteriorGeneralStatus, @interiorGeneralStatus,
        @generalObservation, @hasNewIssue, 0, 0,
        @lifecycleStatus,
        @createdById, @now, @now
      )
    `);
    return { id: String(result.recordset[0].Id) };
  } catch (err) {
    // Race condition on shared kiosk: two concurrent requests hit the same bucket.
    // The unique index caught the collision — fall back to updating the winner row.
    if (isUniqueViolation(err)) {
      const existing = await getInspectionForShift(
        data.vehicleId, data.branchId, data.localDate, data.shift, data.direction,
      );
      if (existing) {
        await updateInspection(existing.id, {
          returnStatus:              data.returnStatus,
          inspectionStatus:          data.inspectionStatus,
          authorizedBy:              data.authorizedBy,
          expectedReturnDate:        data.expectedReturnDate || undefined,
          finalDriverId:             data.finalDriverId,
          finalDriverNameManual:     data.finalDriverNameManual,
          mileage:                   data.mileage,
          previousMileage:           data.previousMileage,
          mileageDifference:         data.mileageDifference,
          mileageWarningType:        data.mileageWarningType,
          mileageWarningConfirmed:   data.mileageWarningConfirmed,
          mileageWarningObservation: data.mileageWarningObservation,
          fuelLevel:                 data.fuelLevel,
          cleanlinessStatus:         data.cleanlinessStatus,
          toolsGeneralStatus:        data.toolsGeneralStatus,
          exteriorGeneralStatus:     data.exteriorGeneralStatus,
          interiorGeneralStatus:     data.interiorGeneralStatus,
          generalObservation:        data.generalObservation,
          hasNewIssue:               data.hasNewIssue,
          lifecycleStatus:           data.lifecycleStatus,
        });
        return { id: existing.id };
      }
    }
    throw err;
  }
}

/**
 * Fetches an inspection by ID, scoped to the caller's tenant.
 * Scope is enforced directly on Inspections.BranchId (the event carries its
 * own branch — no session JOIN needed in the stream model).
 */
export async function getInspectionById(
  id:    string,
  scope: TenantScope,
): Promise<Inspection | null> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(id, 10));
  const scopeClause = applyScopeWhere(req, scope, 'i.BranchId');
  const result = await req.query(`
    SELECT i.* FROM Inspections i
    WHERE i.Id = @id AND ${scopeClause}
  `);
  return result.recordset[0] ? toInspection(result.recordset[0]) : null;
}

/**
 * Returns the existing inspection event for a vehicle in a specific
 * (branch, local date, shift, direction) bucket, or null. Drives the guard
 * "register or update" flow: re-registering the same vehicle in the same shift
 * edits the existing record. Also used as the race-condition fallback in
 * createInspection when UX_Inspections_Bucket fires.
 */
export async function getInspectionForShift(
  vehicleId: string,
  branchId:  number,
  localDate: string,
  shift:     Shift,
  direction: InspectionDirection = 'entry',
): Promise<Inspection | null> {
  const req = getConn();
  req.input('vehicleId',  sql.Int,          parseInt(vehicleId, 10));
  req.input('branchId',   sql.Int,          branchId);
  req.input('localDate',  sql.Date,         localDate);
  req.input('shift',      sql.NVarChar(20), shift);
  req.input('direction',  sql.NVarChar(10), direction);
  const result = await req.query(`
    SELECT TOP 1 * FROM Inspections
    WHERE VehicleId = @vehicleId AND BranchId = @branchId
      AND LocalDate = @localDate AND Shift = @shift AND Direction = @direction
    ORDER BY Id DESC
  `);
  return result.recordset[0] ? toInspection(result.recordset[0]) : null;
}

/**
 * Inspections for a local date (and optional shift) within the caller's scope.
 * Single flexible query that powers the shift report, daily report and export.
 *
 * `lifecycle` controla qué filas se incluyen. DEFAULT 'final' excluye borradores
 * → reportes, export y conteos visto/no-visto quedan intactos. El dashboard del
 * guardia llama con 'all' para poder mostrar los borradores pendientes.
 */
export async function getInspectionsByDate(
  localDate: string,
  scope:     TenantScope,
  shift?:    Shift,
  lifecycle: 'final' | 'all' = 'final',
): Promise<Inspection[]> {
  const req = getConn();
  req.input('localDate', sql.Date, localDate);
  const scopeClause = applyScopeWhere(req, scope, 'i.BranchId');
  let where = `i.LocalDate = @localDate AND ${scopeClause}`;
  if (lifecycle === 'final') {
    where += " AND i.LifecycleStatus = 'final'";
  }
  if (shift) {
    req.input('shift', sql.NVarChar(20), shift);
    where += ' AND i.Shift = @shift';
  }
  const result = await req.query(`
    SELECT i.* FROM Inspections i
    WHERE ${where}
    ORDER BY i.Shift, i.Id
  `);
  return result.recordset.map(toInspection);
}

export async function getInspectionsByVehicle(
  vehicleId: string,
  scope:     TenantScope,
): Promise<Inspection[]> {
  const req = getConn();
  req.input('vehicleId', sql.Int, parseInt(vehicleId, 10));
  const scopeClause = applyScopeWhere(req, scope, 'i.BranchId');
  const result = await req.query(`
    SELECT i.* FROM Inspections i
    WHERE i.VehicleId = @vehicleId AND ${scopeClause}
    ORDER BY i.CreatedAt DESC
  `);
  return result.recordset.map(toInspection);
}

export async function updateInspection(id: string, data: {
  returnStatus?:              ReturnStatus;
  inspectionStatus?:          InspectionStatus;
  authorizedBy?:              string;
  expectedReturnDate?:        string;
  finalDriverId?:             string | null;
  finalDriverNameManual?:     string;
  mileage?:                   number | null;
  previousMileage?:           number;
  mileageDifference?:         number | null;
  mileageWarningType?:        MileageWarningType;
  mileageWarningConfirmed?:   boolean;
  mileageWarningObservation?: string;
  fuelLevel?:                 FuelLevel | null;
  cleanlinessStatus?:         CleanlinessStatus | null;
  toolsGeneralStatus?:        ToolsStatus | null;
  exteriorGeneralStatus?:     GeneralStatus | null;
  interiorGeneralStatus?:     GeneralStatus | null;
  generalObservation?:        string;
  hasNewIssue?:               boolean;
  hasPhotos?:                 boolean;
  lifecycleStatus?:           LifecycleStatus;
  modifiedAfterSeal?:         boolean;
  modifiedBy?:                string;
  modifiedReason?:            string;
}): Promise<void> {
  const req = getConn();
  req.input('id',  sql.Int,          parseInt(id, 10));
  req.input('now', sql.NVarChar(50), new Date().toISOString());

  const set = ['UpdatedAt = @now'];
  if (data.returnStatus              !== undefined) { req.input('returnStatus',              sql.NVarChar(30),   data.returnStatus);                                     set.push('ReturnStatus = @returnStatus'); }
  if (data.inspectionStatus          !== undefined) { req.input('inspectionStatus',          sql.NVarChar(30),   data.inspectionStatus);                                 set.push('InspectionStatus = @inspectionStatus'); }
  if (data.authorizedBy              !== undefined) { req.input('authorizedBy',              sql.NVarChar(200),  data.authorizedBy);                                     set.push('AuthorizedBy = @authorizedBy'); }
  if (data.expectedReturnDate        !== undefined) { req.input('expectedReturnDate',        sql.NVarChar(50),   data.expectedReturnDate || null);                       set.push('ExpectedReturnDate = @expectedReturnDate'); }
  if (data.finalDriverId             !== undefined) { req.input('finalDriverId',             sql.Int,            data.finalDriverId ? parseInt(data.finalDriverId, 10) : null); set.push('FinalDriverId = @finalDriverId'); }
  if (data.finalDriverNameManual     !== undefined) { req.input('finalDriverNameManual',     sql.NVarChar(200),  data.finalDriverNameManual);                            set.push('FinalDriverNameManual = @finalDriverNameManual'); }
  if (data.mileage                   !== undefined) { req.input('mileage',                   sql.Int,            data.mileage);                                          set.push('Mileage = @mileage'); }
  if (data.previousMileage           !== undefined) { req.input('previousMileage',           sql.Int,            data.previousMileage);                                  set.push('PreviousMileage = @previousMileage'); }
  if (data.mileageDifference         !== undefined) { req.input('mileageDifference',         sql.Int,            data.mileageDifference);                                set.push('MileageDifference = @mileageDifference'); }
  if (data.mileageWarningType        !== undefined) { req.input('mileageWarningType',        sql.NVarChar(30),   data.mileageWarningType);                               set.push('MileageWarningType = @mileageWarningType'); }
  if (data.mileageWarningConfirmed   !== undefined) { req.input('mileageWarningConfirmed',   sql.Bit,            data.mileageWarningConfirmed ? 1 : 0);                  set.push('MileageWarningConfirmed = @mileageWarningConfirmed'); }
  if (data.mileageWarningObservation !== undefined) { req.input('mileageWarningObservation', sql.NVarChar(500),  data.mileageWarningObservation);                        set.push('MileageWarningObservation = @mileageWarningObservation'); }
  if (data.fuelLevel                 !== undefined) { req.input('fuelLevel',                 sql.NVarChar(20),   data.fuelLevel);                                        set.push('FuelLevel = @fuelLevel'); }
  if (data.cleanlinessStatus         !== undefined) { req.input('cleanlinessStatus',         sql.NVarChar(20),   data.cleanlinessStatus);                                set.push('CleanlinessStatus = @cleanlinessStatus'); }
  if (data.toolsGeneralStatus        !== undefined) { req.input('toolsGeneralStatus',        sql.NVarChar(20),   data.toolsGeneralStatus);                               set.push('ToolsGeneralStatus = @toolsGeneralStatus'); }
  if (data.exteriorGeneralStatus     !== undefined) { req.input('exteriorGeneralStatus',     sql.NVarChar(20),   data.exteriorGeneralStatus);                            set.push('ExteriorGeneralStatus = @exteriorGeneralStatus'); }
  if (data.interiorGeneralStatus     !== undefined) { req.input('interiorGeneralStatus',     sql.NVarChar(20),   data.interiorGeneralStatus);                            set.push('InteriorGeneralStatus = @interiorGeneralStatus'); }
  if (data.generalObservation        !== undefined) { req.input('generalObservation',        sql.NVarChar(1000), data.generalObservation);                               set.push('GeneralObservation = @generalObservation'); }
  if (data.hasNewIssue               !== undefined) { req.input('hasNewIssue',               sql.Bit,            data.hasNewIssue ? 1 : 0);                             set.push('HasNewIssue = @hasNewIssue'); }
  if (data.hasPhotos                 !== undefined) { req.input('hasPhotos',                 sql.Bit,            data.hasPhotos ? 1 : 0);                               set.push('HasPhotos = @hasPhotos'); }
  if (data.lifecycleStatus           !== undefined) { req.input('lifecycleStatus',           sql.NVarChar(10),   data.lifecycleStatus);                                  set.push('LifecycleStatus = @lifecycleStatus'); }
  if (data.modifiedAfterSeal         !== undefined) { req.input('modifiedAfterSeal',         sql.Bit,            data.modifiedAfterSeal ? 1 : 0);                       set.push('ModifiedAfterSeal = @modifiedAfterSeal'); }
  if (data.modifiedBy                !== undefined) { const mId = parseInt(data.modifiedBy, 10); req.input('modifiedById', sql.Int, Number.isNaN(mId) ? null : mId);              set.push('ModifiedById = @modifiedById'); }
  if (data.modifiedReason            !== undefined) { req.input('modifiedReason',            sql.NVarChar(500),  data.modifiedReason);                                   set.push('ModifiedReason = @modifiedReason'); }

  await req.query(`UPDATE Inspections SET ${set.join(', ')} WHERE Id = @id`);
}

/**
 * Borra un borrador (LifecycleStatus='draft') y sus fotos asociadas.
 * Defensa en profundidad: el WHERE exige 'draft', de modo que jamás puede
 * eliminar un registro finalizado aunque el caller se equivoque de id.
 * La verificación de scope la hace el controller vía getInspectionById.
 * Devuelve true si efectivamente borró una fila borrador.
 */
export async function deleteDraft(id: string): Promise<boolean> {
  const inspectionId = parseInt(id, 10);
  // Las fotos tienen FK a Inspections(Id) sin cascade → borrarlas primero.
  const photoReq = getConn();
  photoReq.input('id', sql.Int, inspectionId);
  await photoReq.query(`DELETE FROM Photos WHERE InspectionId = @id`);

  const req = getConn();
  req.input('id', sql.Int, inspectionId);
  const result = await req.query(`
    DELETE FROM Inspections WHERE Id = @id AND LifecycleStatus = 'draft'
  `);
  return result.rowsAffected[0] > 0;
}

export async function markHasPhotos(inspectionId: string): Promise<void> {
  const req = getConn();
  req.input('id',  sql.Int,          parseInt(inspectionId, 10));
  req.input('now', sql.NVarChar(50), new Date().toISOString());
  await req.query(`UPDATE Inspections SET HasPhotos = 1, UpdatedAt = @now WHERE Id = @id`);
}

/**
 * Monitor suave de completitud (reemplaza el gate de "pendientes").
 * Devuelve los vehículos activos en estado 'active' (en circulación) que NO
 * tienen ninguna inspección reciente (en las últimas `hours` horas). No bloquea
 * a nadie — solo alimenta la vista de supervisión.
 */
export async function getUnseenVehicles(
  scope: TenantScope,
  hours: number,
): Promise<Array<{ vehicleId: string; plate: string; vehicleType: string; brand: string; model: string; branchId: number; hasOpenIssues: boolean; lastSeenAt: string | null }>> {
  const req = getConn();
  req.input('hours', sql.Int, hours);
  const scopeClause = applyScopeWhere(req, scope, 'v.BranchId');
  const result = await req.query(`
    SELECT v.Id, v.Plate, v.VehicleType, v.Brand, v.Model, v.BranchId, v.HasOpenIssues,
           last.LastAt
    FROM Vehicles v
    OUTER APPLY (
      SELECT MAX(i.CreatedAt) AS LastAt FROM Inspections i
      WHERE i.VehicleId = v.Id AND i.LifecycleStatus = 'final'
    ) last
    WHERE v.Active = 1 AND v.CurrentStatus = 'active' AND ${scopeClause}
      AND (last.LastAt IS NULL OR last.LastAt < DATEADD(hour, -@hours, SYSUTCDATETIME()))
      -- Excluye vehículos registrados como "nunca salió" en el turno actual (hoy)
      AND NOT EXISTS (
        SELECT 1 FROM Inspections i2
        WHERE i2.VehicleId = v.Id
          AND CAST(i2.CreatedAt AS DATE) = CAST(SYSUTCDATETIME() AS DATE)
          AND i2.ReturnStatus = 'never_left'
          AND i2.LifecycleStatus = 'final'
      )
    ORDER BY v.Plate
  `);
  return result.recordset.map(r => ({
    vehicleId:     String(r.Id),
    plate:         r.Plate        as string,
    vehicleType:   (r.VehicleType as string | null) ?? '',
    brand:         (r.Brand       as string | null) ?? '',
    model:         (r.Model       as string | null) ?? '',
    branchId:      r.BranchId     as number,
    hasOpenIssues: r.HasOpenIssues as boolean,
    lastSeenAt:    r.LastAt != null ? isoDate(r.LastAt) : null,
  }));
}
