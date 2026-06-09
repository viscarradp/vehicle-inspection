import sql from 'mssql';
import { getConn } from './connection';
import { AppError } from '../middleware/errorHandler';
import type { TenantScope } from '../types';

export interface BranchRow {
  id:        number;
  countryId: number;
  code:      string;
  name:      string;
  address:   string | null;
  active:    boolean;
}

function toBranch(r: Record<string, unknown>): BranchRow {
  return {
    id:        r.Id        as number,
    countryId: r.CountryId as number,
    code:      r.Code      as string,
    name:      r.Name      as string,
    address:   (r.Address  as string | null) ?? null,
    active:    r.Active    as boolean,
  };
}

/**
 * Returns branches visible to a user given their TenantScope.
 * - branch scope  → only their own branch
 * - country scope → all active branches in their country
 * - global scope  → all active branches (optionally filtered by countryId)
 */
export async function getBranches(scope: TenantScope, filterCountryId?: number): Promise<BranchRow[]> {
  const req = getConn();

  let where: string;
  if (scope.kind === 'branch') {
    req.input('branchId', sql.Int, scope.branchId);
    where = 'Id = @branchId AND Active = 1';
  } else if (scope.kind === 'country') {
    req.input('countryId', sql.Int, scope.countryId);
    where = 'CountryId = @countryId AND Active = 1';
  } else {
    if (filterCountryId !== undefined) {
      req.input('countryId', sql.Int, filterCountryId);
      where = 'CountryId = @countryId AND Active = 1';
    } else {
      where = 'Active = 1';
    }
  }

  const result = await req.query(
    `SELECT Id, CountryId, Code, Name, Address, Active FROM Branches WHERE ${where} ORDER BY Name`,
  );
  return result.recordset.map(toBranch);
}

export async function getBranchById(id: number): Promise<BranchRow> {
  const req = getConn();
  req.input('id', sql.Int, id);
  const result = await req.query(
    `SELECT Id, CountryId, Code, Name, Address, Active FROM Branches WHERE Id = @id`,
  );
  if (!result.recordset[0]) throw new AppError(404, 'NOT_FOUND', 'Sucursal no encontrada.');
  return toBranch(result.recordset[0]);
}

export async function createBranch(data: {
  countryId: number;
  code:      string;
  name:      string;
  address?:  string | null;
}): Promise<{ id: number }> {
  const req = getConn();
  const now  = new Date().toISOString();
  req.input('countryId', sql.Int,           data.countryId);
  req.input('code',      sql.NVarChar(20),  data.code.toUpperCase());
  req.input('name',      sql.NVarChar(150), data.name);
  req.input('address',   sql.NVarChar(300), data.address ?? null);
  req.input('now',       sql.NVarChar(50),  now);
  const result = await req.query(`
    INSERT INTO Branches (CountryId, Code, Name, Address, Active, CreatedAt, UpdatedAt)
    OUTPUT INSERTED.Id
    VALUES (@countryId, @code, @name, @address, 1, @now, @now)
  `);
  return { id: result.recordset[0].Id as number };
}

export async function updateBranch(id: number, data: {
  name?:    string;
  address?: string | null;
  code?:    string;
}): Promise<void> {
  const req = getConn();
  req.input('id',  sql.Int,          id);
  req.input('now', sql.NVarChar(50), new Date().toISOString());

  const set: string[] = ['UpdatedAt = @now'];
  if (data.name    !== undefined) { req.input('name',    sql.NVarChar(150), data.name);              set.push('Name = @name'); }
  if (data.address !== undefined) { req.input('address', sql.NVarChar(300), data.address ?? null);   set.push('Address = @address'); }
  if (data.code    !== undefined) { req.input('code',    sql.NVarChar(20),  data.code.toUpperCase()); set.push('Code = @code'); }

  await req.query(`UPDATE Branches SET ${set.join(', ')} WHERE Id = @id`);
}

export async function setBranchActive(id: number, active: boolean): Promise<void> {
  const req = getConn();
  req.input('id',     sql.Int, id);
  req.input('active', sql.Bit, active ? 1 : 0);
  req.input('now',    sql.NVarChar(50), new Date().toISOString());
  await req.query(`UPDATE Branches SET Active = @active, UpdatedAt = @now WHERE Id = @id`);
}

// ─── Timezone (module-level cache) ───────────────────────────────────────────

// Timezones are a property of the country — they change essentially never.
// A module-level cache avoids a DB round-trip on every request with zero risk
// of stale data in practice. A server restart clears it if an edge case arises.
const tzCache = new Map<number, string>();

/**
 * Resolves the IANA timezone for a branch via its country FK.
 * Throws if the branch doesn't exist — callers can't silently build sessions
 * with a missing timezone.
 */
export async function getBranchTimezone(branchId: number): Promise<string> {
  const cached = tzCache.get(branchId);
  if (cached) return cached;

  const req = getConn();
  req.input('branchId', sql.Int, branchId);
  const result = await req.query(`
    SELECT c.Timezone
    FROM   Branches b
    JOIN   Countries c ON c.Id = b.CountryId
    WHERE  b.Id = @branchId
  `);
  const tz = result.recordset[0]?.Timezone as string | undefined;
  if (!tz) throw new Error(`No timezone resolved for branch ${branchId}`);

  tzCache.set(branchId, tz);
  return tz;
}
