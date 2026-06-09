export interface VehicleIdentifierForm {
  chassisNumber: string;
  vin: string;
  engineNumber: string;
}

export function normalizeIdentifierInput(value: string): string | undefined {
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function validateVehicleIdentifiers(fields: {
  chassisNumber?: string;
  vin?: string;
  engineNumber?: string;
}): string | null {
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
