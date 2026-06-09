import { getTypedSettings } from '../db/settings';
import type { MileageValidationResult, MileageWarningType } from '../types';

/**
 * Validates a newly entered mileage against the previous value and the
 * branch-specific threshold from settings.
 *
 * branchId is required so the correct cascade-resolved threshold is used —
 * branch and country overrides are respected, not just the global default.
 */
export async function validateMileage(
  newMileage:      number,
  previousMileage: number,
  branchId:        number,
): Promise<MileageValidationResult> {
  const settings  = await getTypedSettings(branchId);
  const threshold = settings.unusually_high_mileage_threshold;
  const difference = newMileage - previousMileage;

  if (newMileage < previousMileage) {
    return {
      hasWarning:     true,
      warningType:    'lower_than_previous',
      warningMessage: `El kilometraje ingresado (${newMileage.toLocaleString()} km) es menor al último registrado (${previousMileage.toLocaleString()} km). Diferencia: ${Math.abs(difference).toLocaleString()} km. ¿Confirma que el dato es correcto?`,
      previousMileage,
      difference,
    };
  }

  if (difference > threshold) {
    return {
      hasWarning:     true,
      warningType:    'unusually_high',
      warningMessage: `El kilometraje ingresado supera en ${difference.toLocaleString()} km al último registrado. El umbral configurado es ${threshold.toLocaleString()} km. ¿Confirma que el dato es correcto?`,
      previousMileage,
      difference,
    };
  }

  return { hasWarning: false, warningType: 'none', previousMileage, difference };
}

/**
 * Pure (synchronous) version for cases where settings are already loaded.
 * Used when the full settings object has been fetched at the controller level.
 */
export function determineMileageWarningType(
  newMileage:      number,
  previousMileage: number,
  threshold:       number,
): MileageWarningType {
  if (newMileage < previousMileage)             return 'lower_than_previous';
  if (newMileage - previousMileage > threshold) return 'unusually_high';
  return 'none';
}
