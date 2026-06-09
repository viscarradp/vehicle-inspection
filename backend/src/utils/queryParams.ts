import { AppError } from '../middleware/errorHandler';

/**
 * Validates a YYYY-MM-DD date query param, returning `fallback` when absent.
 * Throws AppError 400 (not a 500) when the value is present but malformed, so a
 * bad client param never reaches SQL Server as an invalid CAST.
 */
export function parseDateParam(raw: unknown, fallback: string): string {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AppError(400, 'INVALID_DATE', "El parámetro 'date' debe tener formato YYYY-MM-DD.");
  }
  if (Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new AppError(400, 'INVALID_DATE', "El parámetro 'date' no es una fecha válida.");
  }
  return raw;
}

/**
 * Parses a positive-integer query param, returning `fallback` when absent and
 * clamping to `max` when provided. Throws AppError 400 on non-numeric or < 1
 * values rather than silently producing wrong results.
 */
export function parsePositiveIntParam(raw: unknown, fallback: number, max?: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < 1) {
    throw new AppError(400, 'INVALID_PARAM', 'El parámetro numérico debe ser un entero positivo.');
  }
  return max !== undefined ? Math.min(n, max) : n;
}
