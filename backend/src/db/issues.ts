import sql from 'mssql';
import { getConn } from './connection';
import { applyScopeWhere } from './scopeUtils';
import type { OpenIssue, IssueType, IssueSeverity, IssueStatus, TenantScope } from '../types';

function isoDate(val: unknown): string {
  return val instanceof Date ? val.toISOString() : val as string;
}

function toIssue(r: Record<string, unknown>): OpenIssue {
  return {
    id:                 String(r.Id),
    vehicleId:          String(r.VehicleId),
    branchId:           (r.BranchId         as number | null) ?? undefined,
    plate:              r.Plate             as string,
    inspectionId:       r.InspectionId != null ? String(r.InspectionId) : '',
    issueType:          (r.IssueType        as IssueType | null) ?? 'other',
    category:           (r.Category         as string | null)   ?? undefined,
    description:        (r.Description      as string | null)   ?? '',
    severity:           (r.Severity         as IssueSeverity)   ?? 'medium',
    status:             (r.Status           as IssueStatus)     ?? 'open',
    detectedBy:         (r.DetectedBy       as string | null)   ?? '',
    detectedAt:         isoDate(r.DetectedAt),
    maintenanceAction:  (r.MaintenanceAction  as string | null) ?? undefined,
    closedBy:           r.ClosedById != null ? String(r.ClosedById) : undefined,
    closedAt:           r.ClosedAt != null ? isoDate(r.ClosedAt) : undefined,
    closingObservation: (r.ClosingObservation as string | null) ?? undefined,
  };
}

export async function createIssue(data: {
  vehicleId:    string;
  plate:        string;
  inspectionId: string;
  issueType:    IssueType;
  description:  string;
  severity:     IssueSeverity;
  detectedBy:   string;
}): Promise<{ id: string }> {
  const req = getConn();
  req.input('vehicleId',    sql.Int,            parseInt(data.vehicleId, 10));
  req.input('plate',        sql.NVarChar(20),   data.plate);
  req.input('inspectionId', sql.Int,            parseInt(data.inspectionId, 10));
  req.input('issueType',    sql.NVarChar(40),   data.issueType);
  req.input('description',  sql.NVarChar(1000), data.description);
  req.input('severity',     sql.NVarChar(10),   data.severity);
  req.input('detectedBy',   sql.NVarChar(200),  data.detectedBy);
  const result = await req.query(`
    INSERT INTO OpenIssues
      (VehicleId, Plate, InspectionId, IssueType, Description,
       Severity, Status, DetectedBy)
    OUTPUT INSERTED.Id
    VALUES
      (@vehicleId, @plate, @inspectionId, @issueType, @description,
       @severity, 'open', @detectedBy)
  `);
  return { id: String(result.recordset[0].Id) };
}

/**
 * Fetches a single issue scoped to the caller's tenant.
 * Issues don't have a direct BranchId — scope is enforced via JOIN to Vehicles.
 * Returns null if not found or outside scope; callers respond with 404.
 */
export async function getIssueById(id: string, scope: TenantScope): Promise<OpenIssue | null> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(id, 10));
  const scopeClause = applyScopeWhere(req, scope, 'v.BranchId');
  const result = await req.query(`
    SELECT oi.*, v.BranchId AS BranchId FROM OpenIssues oi
    JOIN Vehicles v ON v.Id = oi.VehicleId
    WHERE oi.Id = @id AND ${scopeClause}
  `);
  return result.recordset[0] ? toIssue(result.recordset[0]) : null;
}

/**
 * Lists issues filtered by optional criteria, scoped to the caller's tenant.
 * Scope is enforced via JOIN to Vehicles — impossible to leak cross-branch data.
 */
export async function getIssues(
  filters: { status?: string; vehicleId?: string; plate?: string },
  scope:   TenantScope,
): Promise<OpenIssue[]> {
  const req = getConn();
  const conditions: string[] = [];

  if (filters.status) {
    req.input('status', sql.NVarChar(20), filters.status);
    conditions.push('oi.Status = @status');
  }
  if (filters.vehicleId) {
    req.input('vehicleId', sql.Int, parseInt(filters.vehicleId, 10));
    conditions.push('oi.VehicleId = @vehicleId');
  }
  if (filters.plate) {
    req.input('plate', sql.NVarChar(20), filters.plate);
    conditions.push('oi.Plate = @plate');
  }

  const scopeClause = applyScopeWhere(req, scope, 'v.BranchId');
  conditions.push(scopeClause);

  const result = await req.query(`
    SELECT oi.* FROM OpenIssues oi
    JOIN Vehicles v ON v.Id = oi.VehicleId
    WHERE ${conditions.join(' AND ')}
    ORDER BY oi.DetectedAt DESC
  `);
  return result.recordset.map(toIssue);
}

/**
 * Lists open issues for a vehicle.
 *
 * When `scope` is supplied the query JOINs Vehicles to enforce tenant scope,
 * preventing cross-branch leakage via the vehicle ID.  Pass scope on every
 * public-facing call (routes/vehicles.ts).
 *
 * When `scope` is omitted (internal use only) all open issues for the vehicle
 * are returned regardless of branch.  Required for `openIssueController` which
 * needs the total count across all operators to update the hasOpenIssues flag
 * after a supervisor closes an issue.
 */
export async function getOpenIssuesByVehicle(vehicleId: string, scope?: TenantScope): Promise<OpenIssue[]> {
  const req = getConn();
  req.input('vehicleId', sql.Int, parseInt(vehicleId, 10));
  if (scope) {
    const scopeClause = applyScopeWhere(req, scope, 'v.BranchId');
    const result = await req.query(`
      SELECT oi.* FROM OpenIssues oi
      JOIN Vehicles v ON v.Id = oi.VehicleId
      WHERE oi.VehicleId = @vehicleId AND oi.Status = 'open' AND ${scopeClause}
      ORDER BY oi.DetectedAt DESC
    `);
    return result.recordset.map(toIssue);
  }
  const result = await req.query(`
    SELECT * FROM OpenIssues
    WHERE VehicleId = @vehicleId AND Status = 'open'
    ORDER BY DetectedAt DESC
  `);
  return result.recordset.map(toIssue);
}

export async function updateIssue(id: string, data: {
  status?:             IssueStatus;
  maintenanceAction?:  string;
  closedBy?:           string;
  closedAt?:           string;
  closingObservation?: string;
}): Promise<void> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(id, 10));

  const set: string[] = [];
  if (data.status             !== undefined) { req.input('status',             sql.NVarChar(20),  data.status);             set.push('Status = @status'); }
  if (data.maintenanceAction  !== undefined) { req.input('maintenanceAction',  sql.NVarChar(500), data.maintenanceAction);  set.push('MaintenanceAction = @maintenanceAction'); }
  if (data.closedBy           !== undefined) { const cId = parseInt(data.closedBy, 10); req.input('closedById', sql.Int, Number.isNaN(cId) ? null : cId);            set.push('ClosedById = @closedById'); }
  if (data.closedAt           !== undefined) { req.input('closedAt',           sql.NVarChar(50),  data.closedAt);           set.push('ClosedAt = @closedAt'); }
  if (data.closingObservation !== undefined) { req.input('closingObservation', sql.NVarChar(500), data.closingObservation); set.push('ClosingObservation = @closingObservation'); }

  if (set.length === 0) return;
  await req.query(`UPDATE OpenIssues SET ${set.join(', ')} WHERE Id = @id`);
}
