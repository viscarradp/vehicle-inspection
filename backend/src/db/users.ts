import sql from 'mssql';
import { getConn } from './connection';
import type { TenantScope, UserRole } from '../types';
import { applyScopeWhere } from './scopeUtils';

// Internal type — includes sensitive fields needed only for auth flows
export interface UserRow {
  id:           number;
  username:     string;
  fullName:     string;
  role:         UserRole;
  active:       boolean;
  passwordHash: string;
  branchId:     number | null;
  countryId:    number | null;
  lastLogin:    string | null;
  createdAt:    string;
  updatedAt:    string;
}

function isoDate(val: unknown): string {
  return val instanceof Date ? val.toISOString() : val as string;
}

function toUserRow(r: Record<string, unknown>): UserRow {
  return {
    id:           r.Id           as number,
    username:     (r.Username    as string).toLowerCase(),
    fullName:     r.FullName     as string,
    role:         r.Role         as UserRole,
    active:       r.Active       as boolean,
    passwordHash: r.PasswordHash as string,
    branchId:     (r.BranchId    as number | null) ?? null,
    countryId:    (r.CountryId   as number | null) ?? null,
    lastLogin:    r.LastLogin != null ? isoDate(r.LastLogin) : null,
    createdAt:    isoDate(r.CreatedAt),
    updatedAt:    isoDate(r.UpdatedAt),
  };
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const req = getConn();
  req.input('username', sql.NVarChar(100), username.toLowerCase());
  const result = await req.query(`
    SELECT u.Id, u.Username, u.FullName, u.Role, u.Active, u.PasswordHash,
           u.BranchId,
           COALESCE(u.CountryId, b.CountryId) AS CountryId,
           u.LastLogin, u.CreatedAt, u.UpdatedAt
    FROM Users u
    LEFT JOIN Branches b ON u.BranchId = b.Id
    WHERE u.Username = @username
  `);
  const row = result.recordset[0];
  return row ? toUserRow(row) : null;
}

export async function getUserById(id: string): Promise<Omit<UserRow, 'passwordHash'>> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(id, 10));
  const result = await req.query(`
    SELECT u.Id, u.Username, u.FullName, u.Role, u.Active,
           u.BranchId,
           COALESCE(u.CountryId, b.CountryId) AS CountryId,
           u.LastLogin, u.CreatedAt, u.UpdatedAt
    FROM Users u
    LEFT JOIN Branches b ON u.BranchId = b.Id
    WHERE u.Id = @id
  `);
  if (!result.recordset[0]) throw new Error(`User ${id} not found`);
  const row = toUserRow({ ...result.recordset[0], PasswordHash: '' });
  const { passwordHash: _, ...rest } = row;
  return rest;
}

export async function updateLastLogin(userId: string, timestamp: string): Promise<void> {
  const req = getConn();
  req.input('id', sql.Int,          parseInt(userId, 10));
  req.input('ts', sql.NVarChar(50), timestamp);
  await req.query(`UPDATE Users SET LastLogin = @ts WHERE Id = @id`);
}

export async function getKioskUsers(): Promise<Array<{ username: string; fullName: string }>> {
  const result = await getConn().query(`
    SELECT Username, FullName
    FROM Users
    WHERE Active = 1 AND Role IN ('guardia', 'jefe_operaciones')
    ORDER BY FullName
  `);
  return result.recordset.map(r => ({
    username: (r.Username as string).toLowerCase(),
    fullName: r.FullName  as string,
  }));
}

export async function getAllUsers(scope: TenantScope): Promise<Omit<UserRow, 'passwordHash'>[]> {
  const req = getConn();
  const scopeClause = applyScopeWhere(req, scope, 'u.BranchId');
  const result = await req.query(`
    SELECT u.Id, u.Username, u.FullName, u.Role, u.Active,
           u.BranchId,
           COALESCE(u.CountryId, b.CountryId) AS CountryId,
           u.LastLogin, u.CreatedAt, u.UpdatedAt
    FROM Users u
    LEFT JOIN Branches b ON u.BranchId = b.Id
    WHERE ${scopeClause}
    ORDER BY u.FullName
  `);
  return result.recordset.map(r => {
    const row = toUserRow({ ...r, PasswordHash: '' });
    const { passwordHash: _, ...rest } = row;
    return rest;
  });
}

export async function createUser(data: {
  username:     string;
  fullName:     string;
  role:         UserRole;
  passwordHash: string;
  branchId?:    number | null;
  countryId?:   number | null;
}): Promise<{ id: string }> {
  const req = getConn();
  const now  = new Date().toISOString();
  req.input('username',     sql.NVarChar(100), data.username.toLowerCase());
  req.input('fullName',     sql.NVarChar(200), data.fullName);
  req.input('role',         sql.NVarChar(30),  data.role);
  req.input('passwordHash', sql.NVarChar(255), data.passwordHash);
  req.input('branchId',     sql.Int,           data.branchId  ?? null);
  req.input('countryId',    sql.Int,           data.countryId ?? null);
  req.input('now',          sql.NVarChar(50),  now);
  const result = await req.query(`
    INSERT INTO Users
      (Username, FullName, Role, PasswordHash, Active, BranchId, CountryId, CreatedAt, UpdatedAt)
    OUTPUT INSERTED.Id
    VALUES
      (@username, @fullName, @role, @passwordHash, 1, @branchId, @countryId, @now, @now)
  `);
  return { id: String(result.recordset[0].Id) };
}

export async function updateUser(id: string, data: {
  fullName?:     string;
  role?:         UserRole;
  active?:       boolean;
  passwordHash?: string;
  branchId?:     number | null;
  countryId?:    number | null;
}): Promise<void> {
  const req = getConn();
  req.input('id',  sql.Int,          parseInt(id, 10));
  req.input('now', sql.NVarChar(50), new Date().toISOString());

  const set: string[] = ['UpdatedAt = @now'];
  if (data.fullName     !== undefined) { req.input('fullName',     sql.NVarChar(200), data.fullName);     set.push('FullName = @fullName'); }
  if (data.role         !== undefined) { req.input('role',         sql.NVarChar(30),  data.role);          set.push('Role = @role'); }
  if (data.active       !== undefined) { req.input('active',       sql.Bit,           data.active ? 1 : 0);set.push('Active = @active'); }
  if (data.passwordHash !== undefined) { req.input('passwordHash', sql.NVarChar(255), data.passwordHash);  set.push('PasswordHash = @passwordHash'); }
  if (data.branchId     !== undefined) { req.input('branchId',     sql.Int,           data.branchId);      set.push('BranchId = @branchId'); }
  if (data.countryId    !== undefined) { req.input('countryId',    sql.Int,           data.countryId);     set.push('CountryId = @countryId'); }

  await req.query(`UPDATE Users SET ${set.join(', ')} WHERE Id = @id`);
}
