import sql from 'mssql';
import { getConn } from './connection';
import type { Driver, TenantScope } from '../types';
import { applyScopeWhere } from './scopeUtils';
import { AppError } from '../middleware/errorHandler';

function isoDate(val: unknown): string {
  return val instanceof Date ? val.toISOString() : val as string;
}

function toDriver(r: Record<string, unknown>): Driver {
  return {
    id:         String(r.Id),
    branchId:   r.BranchId   as number,
    name:       r.Name       as string,
    department: (r.Department as string | null) ?? '',
    active:     r.Active     as boolean,
    createdAt:  isoDate(r.CreatedAt),
  };
}

export async function getActiveDrivers(scope: TenantScope): Promise<Driver[]> {
  const req = getConn();
  const scopeClause = applyScopeWhere(req, scope);
  const result = await req.query(`
    SELECT Id, BranchId, Name, Department, Active, CreatedAt
    FROM Drivers
    WHERE Active = 1 AND ${scopeClause}
    ORDER BY Name
  `);
  return result.recordset.map(toDriver);
}

export async function createDriver(data: {
  name:        string;
  department?: string;
  branchId:    number;
}): Promise<Driver> {
  const req = getConn();
  req.input('branchId',   sql.Int,          data.branchId);
  req.input('name',       sql.NVarChar(200), data.name);
  req.input('department', sql.NVarChar(150), data.department ?? '');
  req.input('now',        sql.NVarChar(50),  new Date().toISOString());
  const result = await req.query(`
    INSERT INTO Drivers (BranchId, Name, Department, Active, CreatedAt)
    OUTPUT INSERTED.*
    VALUES (@branchId, @name, @department, 1, @now)
  `);
  return toDriver(result.recordset[0]);
}

export async function getDriverById(id: string): Promise<Driver> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(id, 10));
  const result = await req.query(`SELECT * FROM Drivers WHERE Id = @id`);
  if (!result.recordset[0]) throw new AppError(404, 'NOT_FOUND', 'Conductor no encontrado.');
  return toDriver(result.recordset[0]);
}

export async function updateDriver(id: string, data: {
  name?:       string;
  department?: string;
  active?:     boolean;
}): Promise<void> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(id, 10));

  const set: string[] = [];
  if (data.name       !== undefined) { req.input('name',       sql.NVarChar(200), data.name);       set.push('Name = @name'); }
  if (data.department !== undefined) { req.input('department', sql.NVarChar(150), data.department); set.push('Department = @department'); }
  if (data.active     !== undefined) { req.input('active',     sql.Bit,           data.active ? 1 : 0); set.push('Active = @active'); }

  if (set.length === 0) return;
  await req.query(`UPDATE Drivers SET ${set.join(', ')} WHERE Id = @id`);
}

/**
 * Todos los conductores del scope (activos e inactivos), para la pantalla de
 * administración. getActiveDrivers se mantiene para el flujo operativo (el
 * formulario de inspección solo ofrece conductores activos).
 */
export async function getAllDrivers(scope: TenantScope): Promise<Driver[]> {
  const req = getConn();
  const scopeClause = applyScopeWhere(req, scope);
  const result = await req.query(`
    SELECT Id, BranchId, Name, Department, Active, CreatedAt
    FROM Drivers
    WHERE ${scopeClause}
    ORDER BY Name
  `);
  return result.recordset.map(toDriver);
}

/** Activa o desactiva (soft-delete) un conductor. */
export async function setDriverActive(id: string, active: boolean): Promise<void> {
  const req = getConn();
  req.input('id',     sql.Int, parseInt(id, 10));
  req.input('active', sql.Bit, active ? 1 : 0);
  await req.query(`UPDATE Drivers SET Active = @active WHERE Id = @id`);
}
