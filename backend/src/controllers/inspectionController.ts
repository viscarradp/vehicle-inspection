import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createInspection,
  updateInspection,
  getInspectionById,
  getInspectionForShift,
  getInspectionsByDate,
} from '../db/inspections';
import {
  getActiveVehicles,
  getVehicleById,
  refreshVehicleMileage,
  setOpenIssuesFlag,
  setVehicleStatus,
} from '../db/vehicles';
import { createIssue } from '../db/issues';
import { createAuditLog } from '../db/audit';
import { validateMileage } from '../services/mileageService';
import { getTypedSettings } from '../db/settings';
import { getBranchTimezone } from '../db/branches';
import { getDateInTimezone, getHourInTimezone, resolveShift, getOperationalDate } from '../db/timezone';
import { resolveScope } from '../middleware/tenantScope';
import { assertResourceInScope } from '../db/scopeUtils';
import type {
  Inspection, Shift, FuelLevel, CleanlinessStatus, GeneralStatus, ToolsStatus,
  MileageWarningType, VehicleDashboardCard, GuardDashboard,
} from '../types';

const SUPERVISOR_ROLES = ['jefe_operaciones', 'admin', 'admin_pais', 'admin_global'];
function isSupervisor(role: string): boolean {
  return SUPERVISOR_ROLES.includes(role);
}

/** Resuelve el contexto de turno actual (server-side) para una sucursal. */
async function shiftContext(branchId: number): Promise<{
  timezone: string; localDate: string; shift: Shift; instant: Date;
}> {
  // Secuencial (no Promise.all): ambas corren sobre la única conexión fijada
  // del request, que no puede multiplexar queries concurrentes.
  const timezone = await getBranchTimezone(branchId);
  const settings = await getTypedSettings(branchId);
  const instant   = new Date();
  const localHour = getHourInTimezone(instant, timezone);
  const shift     = resolveShift(localHour, settings);
  const wallDate  = getDateInTimezone(instant, timezone);
  // Anchor night-shift events to the day the shift STARTED, not the wall date.
  // Prevents midnight splits: 23:00 and 01:00 of the same night → same bucket.
  const localDate = getOperationalDate(wallDate, shift, localHour, settings.shift_morning_start);
  return { timezone, localDate, shift, instant };
}

const inspectionSchema = z.object({
  vehicleId:                 z.string().min(1),
  plate:                     z.string(),
  returnStatus:              z.enum(['received', 'not_returned', 'never_left', 'other']),
  authorizedBy:              z.string().optional(),
  expectedReturnDate:        z.string().optional(),
  finalDriverId:             z.string().optional(),
  finalDriverNameManual:     z.string().optional(),
  mileage:                   z.number().positive().optional(),
  fuelLevel:                 z.enum(['empty', 'quarter', 'half', 'three_quarters', 'full']).optional(),
  cleanlinessStatus:         z.enum(['clean', 'acceptable', 'dirty', 'very_dirty']).optional(),
  toolsGeneralStatus:        z.enum(['ok', 'missing', 'damaged', 'not_applicable']).optional(),
  exteriorGeneralStatus:     z.enum(['ok', 'observed', 'damaged']).optional(),
  interiorGeneralStatus:     z.enum(['ok', 'observed', 'damaged']).optional(),
  generalObservation:        z.string().optional(),
  mileageWarningConfirmed:   z.boolean().optional(),
  mileageWarningObservation: z.string().optional(),
});
type InspectionInput = z.infer<typeof inspectionSchema>;

function deriveInspectionStatus(data: InspectionInput): Inspection['status'] {
  const rs = data.returnStatus;
  if (rs === 'not_returned') return 'not_returned';
  if (rs === 'other')        return 'other';

  // 'received' — vehicle is physically present; derive from inspection data
  const hasIssue =
    data.exteriorGeneralStatus === 'damaged' ||
    data.interiorGeneralStatus === 'damaged' ||
    data.toolsGeneralStatus    === 'missing' ||
    data.toolsGeneralStatus    === 'damaged';

  const hasObs =
    data.exteriorGeneralStatus === 'observed' ||
    data.interiorGeneralStatus === 'observed';

  if (hasIssue) return 'serious_issue';
  if (hasObs || data.cleanlinessStatus === 'dirty' || data.cleanlinessStatus === 'very_dirty')
    return 'reviewed_observation';
  return 'reviewed_ok';
}

/** Valida los campos obligatorios cuando el vehículo se recibe físicamente. */
function validateReceived(data: InspectionInput): { statusCode: string; message: string } | null {
  if (data.returnStatus !== 'received') return null;
  if (!data.finalDriverId && !data.finalDriverNameManual)
    return { statusCode: 'MISSING_DRIVER', message: 'Debe seleccionar o ingresar el conductor final.' };
  if (!data.mileage)
    return { statusCode: 'MISSING_MILEAGE', message: 'El kilometraje es obligatorio para vehículos recibidos.' };
  if (!data.fuelLevel)
    return { statusCode: 'MISSING_FUEL', message: 'El nivel de combustible es obligatorio.' };
  const needsObservation =
    data.exteriorGeneralStatus === 'damaged' || data.interiorGeneralStatus === 'damaged' ||
    data.toolsGeneralStatus    === 'missing' || data.toolsGeneralStatus    === 'damaged';
  if (needsObservation && !data.generalObservation?.trim())
    return { statusCode: 'MISSING_OBSERVATION', message: 'Debe ingresar una observación cuando hay daños o faltantes.' };
  return null;
}

function buildFields(data: InspectionInput, previousMileage: number) {
  const inspectionStatus = deriveInspectionStatus(data);
  const hasNewIssue =
    inspectionStatus === 'serious_issue' ||
    data.toolsGeneralStatus === 'missing' ||
    data.toolsGeneralStatus === 'damaged';
  return {
    inspectionStatus,
    hasNewIssue,
    fields: {
      returnStatus:              data.returnStatus,
      inspectionStatus,
      authorizedBy:              data.authorizedBy          ?? '',
      expectedReturnDate:        data.expectedReturnDate    ?? '',
      finalDriverId:             data.finalDriverId         ?? null,
      finalDriverNameManual:     data.finalDriverNameManual ?? '',
      mileage:                   data.mileage               ?? null,
      previousMileage,
      mileageDifference:         data.mileage ? data.mileage - previousMileage : null,
      mileageWarningConfirmed:   data.mileageWarningConfirmed   ?? false,
      mileageWarningObservation: data.mileageWarningObservation ?? '',
      fuelLevel:                 (data.fuelLevel             ?? null) as FuelLevel | null,
      cleanlinessStatus:         (data.cleanlinessStatus     ?? null) as CleanlinessStatus | null,
      toolsGeneralStatus:        (data.toolsGeneralStatus    ?? null) as ToolsStatus | null,
      exteriorGeneralStatus:     (data.exteriorGeneralStatus ?? null) as GeneralStatus | null,
      interiorGeneralStatus:     (data.interiorGeneralStatus ?? null) as GeneralStatus | null,
      generalObservation:        data.generalObservation     ?? '',
      hasNewIssue,
    },
  };
}

// ─── Guard dashboard (turno actual, sin sesión) ────────────────────────────────

export async function getGuardDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawBranch = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
    const branchId  = (rawBranch && !isNaN(rawBranch)) ? rawBranch : req.user!.branchId;
    if (!branchId) {
      res.status(400).json({
        success: false, statusCode: 'NO_BRANCH',
        message: 'Selecciona una sucursal o asigna una a tu usuario.',
        uiState: 'validation_error',
      });
      return;
    }

    const scope = resolveScope(req.user!, rawBranch);
    const { timezone, localDate, shift } = await shiftContext(branchId);
    const settings = await getTypedSettings(branchId);
    const noReviewDays = settings.no_review_days_threshold;

    // Secuencial (no Promise.all): ambas corren sobre la única conexión fijada
    // del request, que no puede multiplexar queries concurrentes.
    const vehicles         = await getActiveVehicles(scope);
    const todayInspections = await getInspectionsByDate(localDate, scope);  // sin turno: cualquier insp de hoy
    const inspByVehicle = new Map(todayInspections.map(i => [i.vehicleId, i]));

    const cards: VehicleDashboardCard[] = vehicles.map(v => {
      const insp = inspByVehicle.get(v.id);
      let daysSinceLastReview: number | undefined;
      let noReviewAlert = false;
      if (v.lastInspectionDate) {
        const [ty, tm, td] = localDate.split('-').map(Number);
        const lastLocal    = v.lastInspectionDate.split('T')[0];
        const [ly, lm, ld] = lastLocal.split('-').map(Number);
        const todayMs = Date.UTC(ty, tm - 1, td);
        const lastMs  = Date.UTC(ly, lm - 1, ld);
        daysSinceLastReview = Math.floor((todayMs - lastMs) / 86_400_000);
        noReviewAlert       = daysSinceLastReview >= noReviewDays;
      } else {
        noReviewAlert = true;
      }
      return {
        vehicleId:                   v.id,
        plate:                       v.plate,
        vehicleType:                 v.vehicleType,
        brand:                       v.brand,
        model:                       v.model,
        currentStatus:               v.currentStatus,
        currentStatusExpectedReturn: v.currentStatusExpectedReturn,
        hasOpenIssues:               v.hasOpenIssues,
        todayRecord: insp
          ? {
              kind:              insp.returnStatus,
              inspectionId:      insp.id,
              inspectionStatus:  insp.returnStatus === 'received' ? insp.status : undefined,
            }
          : { kind: 'none' },
        lastInspectionDate:  v.lastInspectionDate,
        daysSinceLastReview,
        noReviewAlert,
        lastMileage:         v.lastMileage ?? 0,
      };
    });

    const seen   = cards.filter(c => c.todayRecord.kind === 'received').length;
    const unseen = cards.filter(c => c.currentStatus === 'active' && c.todayRecord.kind === 'none').length;

    const dashboard: GuardDashboard = {
      branchId, localDate, shift, timezone,
      guardName: req.user!.fullName,
      vehicles:  cards,
      counts: { total: cards.length, seen, unseen },
    };

    res.json({
      success: true, statusCode: 'OK', message: 'Dashboard del turno cargado.',
      uiState: 'saved_successfully', data: dashboard,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Registrar / actualizar inspección del turno actual (guardia) ──────────────

export async function createOrUpdateInspection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = inspectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false, statusCode: 'VALIDATION_ERROR', message: 'Datos de inspección inválidos.',
        uiState: 'validation_error', errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const data = parsed.data;

    const branchId = req.user!.branchId;
    if (!branchId) {
      res.status(400).json({
        success: false, statusCode: 'NO_BRANCH',
        message: 'El usuario no tiene sucursal asignada.', uiState: 'validation_error',
      });
      return;
    }

    const scope   = resolveScope(req.user!);
    const vehicle = await getVehicleById(data.vehicleId);
    if (!vehicle) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Vehículo no encontrado.', uiState: 'not_found' });
      return;
    }
    // El vehículo debe pertenecer a la sucursal/país del guardia.
    await assertResourceInScope(vehicle.branchId, scope);
    if (vehicle.branchId !== branchId) {
      res.status(403).json({
        success: false, statusCode: 'VEHICLE_OTHER_BRANCH',
        message: 'El vehículo no pertenece a tu sucursal.', uiState: 'unauthorized',
      });
      return;
    }

    const validationError = validateReceived(data);
    if (validationError) {
      res.status(400).json({ success: false, ...validationError, uiState: 'validation_error' });
      return;
    }

    const { localDate, shift, instant } = await shiftContext(branchId);
    const now      = instant.toISOString();
    const existing = await getInspectionForShift(data.vehicleId, branchId, localDate, shift, 'entry');

    // Baseline de kilometraje: si ya hay registro de este turno se mantiene su
    // baseline; si es nuevo, se usa el último km conocido del vehículo.
    const previousMileage = existing ? (existing.previousMileage ?? 0) : vehicle.lastMileage;

    // Filtro antifraude de kilometraje (solo recibidos). El cliente reenvía con
    // mileageWarningConfirmed=true tras confirmar — no se persiste hasta entonces.
    let mileageWarningType: MileageWarningType = 'none';
    if (data.mileage && data.returnStatus === 'received') {
      const validation = await validateMileage(data.mileage, previousMileage, branchId);
      if (validation.hasWarning && !data.mileageWarningConfirmed) {
        res.status(200).json({
          success: false, statusCode: 'MILEAGE_WARNING', message: validation.warningMessage,
          uiState: 'mileage_warning',
          data: {
            warningType: validation.warningType, previousMileage: validation.previousMileage,
            newMileage: data.mileage, difference: validation.difference,
          },
        });
        return;
      }
      mileageWarningType = validation.warningType;
    }

    const { hasNewIssue, fields } = buildFields(data, previousMileage);

    let inspectionId: string;
    let isFirstIssueDetection: boolean;
    if (existing) {
      await updateInspection(existing.id, { ...fields, mileageWarningType });
      inspectionId          = existing.id;
      isFirstIssueDetection = hasNewIssue && !existing.hasNewIssue;
    } else {
      const created = await createInspection({
        branchId, vehicleId: data.vehicleId, plate: data.plate,
        localDate, shift, direction: 'entry',
        guardId: req.user!.userId, guardName: req.user!.fullName,
        ...fields, mileageWarningType, createdBy: req.user!.userId, now,
      });
      inspectionId          = created.id;
      isFirstIssueDetection = hasNewIssue;
    }

    if (data.returnStatus === 'received') {
      if (data.mileage) await refreshVehicleMileage(data.vehicleId);
      // Recibir físicamente un vehículo limpia cualquier estado de ausencia:
      // vuelve a 'active' y el monitor deja de marcarlo.
      if (vehicle.currentStatus !== 'active') {
        await setVehicleStatus({
          vehicleId: data.vehicleId, newStatus: 'active',
          reason: 'Recibido físicamente en garita', changedBy: req.user!.userId,
        });
      }
    }

    if (isFirstIssueDetection) {
      const issue = await createIssue({
        vehicleId: data.vehicleId, plate: data.plate, inspectionId,
        issueType: data.toolsGeneralStatus === 'missing' ? 'missing_tool' : 'damage',
        description: data.generalObservation ?? 'Daño o faltante detectado',
        severity: 'medium', detectedBy: req.user!.fullName,
      });
      await setOpenIssuesFlag(data.vehicleId, true);
      res.json({
        success: true, statusCode: 'INSPECTION_SAVED_WITH_ISSUE',
        message: 'Inspección guardada. Se creó un problema abierto para seguimiento.',
        uiState: 'open_issue_created',
        data: { inspectionId, issueId: issue.id, status: fields.inspectionStatus },
      });
      return;
    }

    res.json({
      success: true, statusCode: 'INSPECTION_SAVED', message: 'Inspección guardada correctamente.',
      uiState: 'saved_successfully', data: { inspectionId, status: fields.inspectionStatus },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Editar una inspección por id (supervisor) ─────────────────────────────────
//
// Editar una inspección de un turno PASADO (sellada) requiere supervisor +
// justificación, que queda en AuditLogs. Editar una del turno actual también
// pasa por aquí cuando lo hace un supervisor desde la vista de turno.

export async function editInspection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!isSupervisor(req.user!.role)) {
      res.status(403).json({
        success: false, statusCode: 'FORBIDDEN',
        message: 'Solo un supervisor puede editar una inspección registrada.', uiState: 'unauthorized',
      });
      return;
    }

    const parsed = inspectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false, statusCode: 'VALIDATION_ERROR', message: 'Datos de inspección inválidos.',
        uiState: 'validation_error', errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const data = parsed.data;

    const scope      = resolveScope(req.user!);
    const existing   = await getInspectionById(req.params.id, scope);
    if (!existing) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Inspección no encontrada.', uiState: 'not_found' });
      return;
    }

    const validationError = validateReceived(data);
    if (validationError) {
      res.status(400).json({ success: false, ...validationError, uiState: 'validation_error' });
      return;
    }

    // ¿Sellada? Una inspección queda sellada cuando ya no es el turno actual.
    const { localDate, shift, instant } = await shiftContext(existing.branchId);
    const isSealed = existing.localDate !== localDate || existing.shift !== shift;
    const reason   = (req.body.modificationReason as string | undefined)?.trim();
    if (isSealed && !reason) {
      res.status(400).json({
        success: false, statusCode: 'MODIFICATION_REASON_REQUIRED',
        message: 'Debe ingresar el motivo de la corrección de un turno ya cerrado.', uiState: 'validation_error',
      });
      return;
    }

    const previousMileage = existing.previousMileage ?? 0;
    let mileageWarningType: MileageWarningType = existing.mileageWarningType;
    if (data.mileage && data.returnStatus === 'received') {
      const validation = await validateMileage(data.mileage, previousMileage, existing.branchId);
      if (validation.hasWarning && !data.mileageWarningConfirmed) {
        res.status(200).json({
          success: false, statusCode: 'MILEAGE_WARNING', message: validation.warningMessage,
          uiState: 'mileage_warning',
          data: { warningType: validation.warningType, previousMileage, newMileage: data.mileage, difference: validation.difference },
        });
        return;
      }
      mileageWarningType = validation.warningType;
    }

    const { hasNewIssue, fields } = buildFields(data, previousMileage);

    await updateInspection(existing.id, {
      ...fields, mileageWarningType,
      ...(isSealed ? { modifiedAfterSeal: true, modifiedBy: req.user!.userId, modifiedReason: reason } : {}),
    });

    if (data.returnStatus === 'received' && data.mileage) {
      await refreshVehicleMileage(existing.vehicleId);
    }

    // Primera detección de problema en la edición
    if (hasNewIssue && !existing.hasNewIssue) {
      const issue = await createIssue({
        vehicleId: existing.vehicleId, plate: existing.plate, inspectionId: existing.id,
        issueType: data.toolsGeneralStatus === 'missing' ? 'missing_tool' : 'damage',
        description: data.generalObservation ?? 'Daño o faltante detectado',
        severity: 'medium', detectedBy: req.user!.fullName,
      });
      await setOpenIssuesFlag(existing.vehicleId, true);
      if (isSealed) await logSealEdit(req, existing, fields, reason!);
      res.json({
        success: true, statusCode: 'INSPECTION_SAVED_WITH_ISSUE',
        message: 'Inspección actualizada. Se creó un problema abierto.', uiState: 'open_issue_created',
        data: { inspectionId: existing.id, issueId: issue.id, status: fields.inspectionStatus },
      });
      return;
    }

    if (isSealed) await logSealEdit(req, existing, fields, reason!);

    res.json({
      success: true, statusCode: 'INSPECTION_SAVED', message: 'Inspección actualizada correctamente.',
      uiState: 'saved_successfully', data: { inspectionId: existing.id, status: fields.inspectionStatus },
    });
  } catch (err) {
    next(err);
  }
}

async function logSealEdit(req: Request, existing: Inspection, newValue: unknown, reason: string): Promise<void> {
  await createAuditLog({
    userId:   req.user!.userId,
    userName: req.user!.fullName,
    action:   'UPDATE_AFTER_SEAL',
    entity:   'Inspection',
    entityId: existing.id,
    oldValue: existing,
    newValue,
    reason,
    branchId: existing.branchId,
  });
}

export async function getInspection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const inspection = await getInspectionById(req.params.id, resolveScope(req.user!));
    if (!inspection) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Inspección no encontrada.', uiState: 'not_found' });
      return;
    }
    res.json({ success: true, statusCode: 'OK', message: 'Inspección encontrada.', uiState: 'saved_successfully', data: inspection });
  } catch (err) {
    next(err);
  }
}
