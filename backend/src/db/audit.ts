import sql from 'mssql';
import { getConn } from './connection';
import type { AuditLog, TenantScope } from '../types';

function isoDate(val: unknown): string {
  return val instanceof Date ? val.toISOString() : val as string;
}

export async function createAuditLog(params: {
  userId:     string;
  userName:   string;
  action:     string;
  entity:     string;
  entityId:   string;
  oldValue?:  unknown;
  newValue?:  unknown;
  reason?:    string;
  branchId?:  number;
  countryId?: number;
  ipAddress?: string;
}): Promise<void> {
  const req = getConn();
  const userIdInt = params.userId != null && params.userId !== '' ? parseInt(params.userId, 10) : null;
  req.input('userId',    sql.Int,               Number.isNaN(userIdInt as number) ? null : userIdInt);
  req.input('userName',  sql.NVarChar(200),     params.userName);
  req.input('action',    sql.NVarChar(100),     params.action);
  req.input('entity',    sql.NVarChar(100),     params.entity);
  req.input('entityId',  sql.NVarChar(50),      params.entityId);
  req.input('oldVal',    sql.NVarChar(sql.MAX), params.oldValue != null ? JSON.stringify(params.oldValue) : '');
  req.input('newVal',    sql.NVarChar(sql.MAX), params.newValue != null ? JSON.stringify(params.newValue) : '');
  req.input('reason',    sql.NVarChar(500),     params.reason ?? '');
  req.input('branchId',  sql.Int,               params.branchId  ?? null);
  req.input('countryId', sql.Int,               params.countryId ?? null);
  req.input('ip',        sql.NVarChar(50),      params.ipAddress ?? '');
  // CountryId is used to scope audit reads (AuditLogs is intentionally outside
  // RLS). Use the explicit countryId when given (country/global-targeted
  // actions), otherwise derive it from the branch so every branch-level row is
  // still reachable by a country-scoped admin.
  await req.query(`
    INSERT INTO AuditLogs
      (UserId, UserName, BranchId, CountryId, Action, Entity, EntityId, OldValue, NewValue, Reason, IpAddress)
    VALUES
      (@userId, @userName, @branchId,
       COALESCE(@countryId, (SELECT CountryId FROM Branches WHERE Id = @branchId)),
       @action, @entity, @entityId, @oldVal, @newVal, @reason, @ip)
  `);
}

export async function getAuditLogs(
  filters: {
    entity?:   string;
    entityId?: string;
  } = {},
  scope: TenantScope,
): Promise<AuditLog[]> {
  const req = getConn();
  const conditions: string[] = [];

  if (filters.entity) {
    req.input('entity', sql.NVarChar(100), filters.entity);
    conditions.push('Entity = @entity');
  }
  if (filters.entityId) {
    req.input('entityId', sql.NVarChar(50), filters.entityId);
    conditions.push('EntityId = @entityId');
  }

  // Tenant scope — AuditLogs is intentionally outside RLS, so the boundary is
  // enforced here. Branch-level rows carry a derived CountryId, so country scope
  // sees every branch in its country plus country-level entries; branch scope
  // sees only its own rows; global sees everything.
  if (scope.kind === 'branch') {
    req.input('scopeBranchId', sql.Int, scope.branchId);
    conditions.push('BranchId = @scopeBranchId');
  } else if (scope.kind === 'country') {
    req.input('scopeCountryId', sql.Int, scope.countryId);
    conditions.push('CountryId = @scopeCountryId');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await req.query(`
    SELECT Id, UserId, UserName, Action, Entity, EntityId,
           OldValue, NewValue, Reason, Timestamp
    FROM AuditLogs ${where}
    ORDER BY Timestamp DESC
  `);

  return result.recordset.map(r => ({
    id:        String(r.Id),
    userId:    String(r.UserId ?? ''),
    userName:  r.UserName  as string ?? '',
    action:    r.Action    as string ?? '',
    entity:    r.Entity    as string ?? '',
    entityId:  r.EntityId  as string ?? '',
    oldValue:  (r.OldValue  as string | null) ?? undefined,
    newValue:  (r.NewValue  as string | null) ?? undefined,
    reason:    (r.Reason    as string | null) ?? undefined,
    timestamp: isoDate(r.Timestamp),
  }));
}
