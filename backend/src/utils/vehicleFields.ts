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
