import sql from 'mssql';
import { getConn } from './connection';
import type { VehicleStatusType } from '../types';

function toType(r: Record<string, unknown>): VehicleStatusType {
  return {
    id:         r.Id         as number,
    key:        r.Key        as string,
    labelEs:    r.LabelEs    as string,
    color:      r.Color      as string,
    countryId:  (r.CountryId as number | null) ?? undefined,
    isSystem:   r.IsSystem   as boolean,
    active:     r.Active     as boolean,
    sortOrder:  r.SortOrder  as number,
  };
}

/** Lista todos los tipos activos visibles para un país dado.
 *  Incluye los globales (CountryId IS NULL) + los del país si se pasa countryId. */
export async function getVehicleStatusTypes(countryId?: number): Promise<VehicleStatusType[]> {
  const req = getConn();
  if (countryId != null) {
    req.input('countryId', sql.Int, countryId);
    const result = await req.query(`
      SELECT * FROM VehicleStatusTypes
      WHERE Active = 1 AND [Key] <> 'active'
        AND (CountryId IS NULL OR CountryId = @countryId)
      ORDER BY SortOrder, LabelEs
    `);
    return result.recordset.map(toType);
  }
  const result = await req.query(`
    SELECT * FROM VehicleStatusTypes
    WHERE Active = 1 AND [Key] <> 'active'
    ORDER BY SortOrder, LabelEs
  `);
  return result.recordset.map(toType);
}

/** Lista TODOS (activos e inactivos) — solo para la página de administración. */
export async function getAllVehicleStatusTypes(countryId?: number): Promise<VehicleStatusType[]> {
  const req = getConn();
  if (countryId != null) {
    req.input('countryId', sql.Int, countryId);
    const result = await req.query(`
      SELECT * FROM VehicleStatusTypes
      WHERE [Key] <> 'active' AND (CountryId IS NULL OR CountryId = @countryId)
      ORDER BY IsSystem DESC, SortOrder, LabelEs
    `);
    return result.recordset.map(toType);
  }
  const result = await req.query(`
    SELECT * FROM VehicleStatusTypes
    WHERE [Key] <> 'active'
    ORDER BY IsSystem DESC, SortOrder, LabelEs
  `);
  return result.recordset.map(toType);
}

export async function getVehicleStatusTypeById(id: number): Promise<VehicleStatusType | null> {
  const req = getConn();
  req.input('id', sql.Int, id);
  const result = await req.query(`SELECT * FROM VehicleStatusTypes WHERE Id = @id`);
  return result.recordset[0] ? toType(result.recordset[0]) : null;
}

export async function createVehicleStatusType(data: {
  key:        string;
  labelEs:    string;
  color:      string;
  countryId?: number;
  sortOrder?: number;
}): Promise<VehicleStatusType> {
  const req = getConn();
  req.input('key',       sql.NVarChar(50),  data.key);
  req.input('labelEs',   sql.NVarChar(100), data.labelEs);
  req.input('color',     sql.NVarChar(30),  data.color);
  req.input('countryId', sql.Int,           data.countryId ?? null);
  req.input('sortOrder', sql.Int,           data.sortOrder ?? 0);
  const result = await req.query(`
    INSERT INTO VehicleStatusTypes ([Key], LabelEs, Color, CountryId, IsSystem, Active, SortOrder)
    OUTPUT INSERTED.*
    VALUES (@key, @labelEs, @color, @countryId, 0, 1, @sortOrder)
  `);
  return toType(result.recordset[0]);
}

export async function updateVehicleStatusType(id: number, data: {
  labelEs?:   string;
  color?:     string;
  sortOrder?: number;
}): Promise<void> {
  const req = getConn();
  req.input('id',  sql.Int,           id);
  req.input('now', sql.NVarChar(50),  new Date().toISOString());
  const set = ['UpdatedAt = @now'];
  if (data.labelEs   !== undefined) { req.input('labelEs',   sql.NVarChar(100), data.labelEs);  set.push('LabelEs = @labelEs'); }
  if (data.color     !== undefined) { req.input('color',     sql.NVarChar(30),  data.color);    set.push('Color = @color'); }
  if (data.sortOrder !== undefined) { req.input('sortOrder', sql.Int,           data.sortOrder); set.push('SortOrder = @sortOrder'); }
  await req.query(`UPDATE VehicleStatusTypes SET ${set.join(', ')} WHERE Id = @id`);
}

export async function toggleVehicleStatusType(id: number, active: boolean): Promise<void> {
  const req = getConn();
  req.input('id',     sql.Int,          id);
  req.input('active', sql.Bit,          active ? 1 : 0);
  req.input('now',    sql.NVarChar(50), new Date().toISOString());
  await req.query(`UPDATE VehicleStatusTypes SET Active = @active, UpdatedAt = @now WHERE Id = @id`);
}

/** Elimina solo tipos NO-sistema. Devuelve false si el tipo es sistema o no existe. */
export async function deleteVehicleStatusType(id: number): Promise<boolean> {
  const req = getConn();
  req.input('id', sql.Int, id);
  const result = await req.query(`
    DELETE FROM VehicleStatusTypes
    OUTPUT DELETED.Id
    WHERE Id = @id AND IsSystem = 0
  `);
  return result.recordset.length > 0;
}
