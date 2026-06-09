import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getVehicleById, setVehicleStatus } from '../db/vehicles';
import { getUnseenVehicles } from '../db/inspections';
import { getTypedSettings } from '../db/settings';
import { resolveScope } from '../middleware/tenantScope';
import { assertResourceInScope } from '../db/scopeUtils';

const statusSchema = z.object({
  status:             z.enum(['active', 'workshop', 'night_service', 'abroad', 'special_authorization']),
  reason:             z.string().optional(),
  expectedReturnDate: z.string().optional(),
});

/**
 * PATCH /vehicles/:id/status — cambia el estado persistente del vehículo.
 * Disponible para guardias (pueden marcar que un vehículo salió a servicio
 * nocturno, etc.) y supervisores, siempre dentro de su scope. Auditado en
 * VehicleStatusLog.
 */
export async function updateVehicleStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false, statusCode: 'VALIDATION_ERROR', message: 'Estado de vehículo inválido.',
        uiState: 'validation_error', errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const scope   = resolveScope(req.user!);
    const vehicle = await getVehicleById(req.params.id);
    await assertResourceInScope(vehicle.branchId, scope);

    const { changed, oldStatus } = await setVehicleStatus({
      vehicleId:          req.params.id,
      newStatus:          parsed.data.status,
      reason:             parsed.data.reason,
      expectedReturnDate: parsed.data.expectedReturnDate ?? null,
      changedBy:          req.user!.userId,
    });

    res.json({
      success: true, statusCode: changed ? 'VEHICLE_STATUS_CHANGED' : 'VEHICLE_STATUS_UNCHANGED',
      message: changed
        ? `Estado del vehículo actualizado a "${parsed.data.status}".`
        : 'El vehículo ya tenía ese estado.',
      uiState: 'saved_successfully',
      data: { vehicleId: req.params.id, oldStatus, newStatus: parsed.data.status, changed },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /vehicles/unseen — monitor suave de completitud (supervisión).
 * Vehículos activos ('active') sin inspección en las últimas N horas
 * (N = setting unseen_alert_hours, resuelto por sucursal del usuario).
 */
export async function getUnseen(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = resolveScope(req.user!);
    // Resuelve el umbral por la sucursal del usuario; para country/global usa el
    // default del registry (no hay una sucursal única que resolver).
    const hours = req.user!.branchId
      ? (await getTypedSettings(req.user!.branchId)).unseen_alert_hours
      : 8;
    const vehicles = await getUnseenVehicles(scope, hours);
    res.json({
      success: true, statusCode: 'OK',
      message: `${vehicles.length} vehículo(s) sin inspección en las últimas ${hours}h.`,
      uiState: 'saved_successfully', data: { hours, vehicles },
    });
  } catch (err) {
    next(err);
  }
}
