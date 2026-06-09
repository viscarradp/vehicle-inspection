export interface VehicleIdentifierInput {
  chassisNumber?: string;
  vin?: string;
  engineNumber?: string;
}

export function normalizeOptionalIdentifier(value: unknown): string | undefined {
  if (value == null || typeof value !== 'string') return undefined;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Para updates: distingue campo ausente (undefined) de campo vacío (null). */
export function resolveIdentifierField(
  body: Record<string, unknown>,
  key: keyof VehicleIdentifierInput,
): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeVehicleIdentifiers(body: Record<string, unknown>): VehicleIdentifierInput {
  return {
    chassisNumber: normalizeOptionalIdentifier(body.chassisNumber),
    vin:           normalizeOptionalIdentifier(body.vin),
    engineNumber:  normalizeOptionalIdentifier(body.engineNumber),
  };
}

export function resolveVehicleIdentifiersForUpdate(body: Record<string, unknown>): {
  chassisNumber?: string | null;
  vin?: string | null;
  engineNumber?: string | null;
} {
  return {
    chassisNumber: resolveIdentifierField(body, 'chassisNumber'),
    vin:           resolveIdentifierField(body, 'vin'),
    engineNumber:  resolveIdentifierField(body, 'engineNumber'),
  };
}

/** Devuelve el primer mensaje de error o null si todo es válido. */
export function validateVehicleIdentifiers(fields: VehicleIdentifierInput): string | null {
  if (fields.vin) {
    if (fields.vin.length < 11 || fields.vin.length > 17) {
      return 'El VIN debe tener entre 11 y 17 caracteres.';
    }
    if (!/^[A-HJ-NPR-Z0-9]+$/.test(fields.vin)) {
      return 'El VIN solo puede contener letras (sin I, O, Q) y números.';
    }
  }

  if (fields.chassisNumber) {
    if (fields.chassisNumber.length < 3 || fields.chassisNumber.length > 50) {
      return 'El número de chasis debe tener entre 3 y 50 caracteres.';
    }
    if (!/^[A-Z0-9\- ]+$/.test(fields.chassisNumber)) {
      return 'El número de chasis solo puede contener letras, números, guiones y espacios.';
    }
  }

  if (fields.engineNumber) {
    if (fields.engineNumber.length < 3 || fields.engineNumber.length > 50) {
      return 'El número de motor debe tener entre 3 y 50 caracteres.';
    }
    if (!/^[A-Z0-9\- ]+$/.test(fields.engineNumber)) {
      return 'El número de motor solo puede contener letras, números, guiones y espacios.';
    }
  }

  return null;
}

// ─── Initial mileage ──────────────────────────────────────────────────────────

/**
 * Kilometraje máximo aceptado al registrar un vehículo. Un odómetro de 7 dígitos
 * llega a 9 999 999; acotar aquí evita que un valor absurdo (negativo o de miles
 * de millones) corrompa los cálculos antifraude de diferencia de kilometraje.
 */
export const MAX_INITIAL_MILEAGE = 9_999_999;

/**
 * Valida y normaliza el kilometraje inicial recibido en el body de creación.
 *
 * Devuelve:
 *  - el entero validado (0 … {@link MAX_INITIAL_MILEAGE}) si es válido;
 *  - 0 si el campo viene ausente/vacío (valor por defecto);
 *  - null si el valor es inválido (no entero, negativo, fuera de rango o de un
 *    tipo no numérico) → el caller debe responder 400.
 *
 * Usa Number() y no parseInt(): parseInt('100abc') devuelve 100 en silencio,
 * mientras que Number('100abc') es NaN y se rechaza. También rechaza decimales,
 * NaN, Infinity y tipos no numéricos (booleanos, objetos, arrays).
 */
export function parseInitialMileage(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const n = typeof raw === 'number' ? raw : Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > MAX_INITIAL_MILEAGE) return null;
  return n;
}
