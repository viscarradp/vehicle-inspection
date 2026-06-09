import sql from 'mssql';
import { getConn } from './connection';

export interface CountryRow {
  id:       number;
  code:     string;
  name:     string;
  timezone: string;
  active:   boolean;
}

function toCountry(r: Record<string, unknown>): CountryRow {
  return {
    id:       r.Id       as number,
    code:     r.Code     as string,
    name:     r.Name     as string,
    timezone: r.Timezone as string,
    active:   r.Active   as boolean,
  };
}

export async function getCountries(includeInactive = false): Promise<CountryRow[]> {
  const where  = includeInactive ? '' : 'WHERE Active = 1';
  const result = await getConn().query(
    `SELECT Id, Code, Name, Timezone, Active FROM Countries ${where} ORDER BY Name`,
  );
  return result.recordset.map(toCountry);
}

export async function getCountryById(id: number): Promise<CountryRow> {
  const req = getConn();
  req.input('id', sql.Int, id);
  const result = await req.query(
    `SELECT Id, Code, Name, Timezone, Active FROM Countries WHERE Id = @id`,
  );
  if (!result.recordset[0]) throw new Error(`Country ${id} not found`);
  return toCountry(result.recordset[0]);
}

export async function createCountry(data: {
  code:     string;
  name:     string;
  timezone: string;
}): Promise<{ id: number }> {
  const req = getConn();
  req.input('code',     sql.NVarChar(5),   data.code.toUpperCase());
  req.input('name',     sql.NVarChar(100), data.name);
  req.input('timezone', sql.NVarChar(60),  data.timezone);
  const result = await req.query(`
    INSERT INTO Countries (Code, Name, Timezone)
    OUTPUT INSERTED.Id
    VALUES (@code, @name, @timezone)
  `);
  return { id: result.recordset[0].Id as number };
}

export async function updateCountry(id: number, data: {
  name?:     string;
  timezone?: string;
}): Promise<void> {
  const req = getConn();
  req.input('id', sql.Int, id);

  const set: string[] = [];
  if (data.name     !== undefined) { req.input('name',     sql.NVarChar(100), data.name);     set.push('Name = @name'); }
  if (data.timezone !== undefined) { req.input('timezone', sql.NVarChar(60),  data.timezone); set.push('Timezone = @timezone'); }

  if (!set.length) return;
  await req.query(`UPDATE Countries SET ${set.join(', ')} WHERE Id = @id`);
}

export async function setCountryActive(id: number, active: boolean): Promise<void> {
  const req = getConn();
  req.input('id',     sql.Int, id);
  req.input('active', sql.Bit, active ? 1 : 0);
  await req.query(`UPDATE Countries SET Active = @active WHERE Id = @id`);
}
