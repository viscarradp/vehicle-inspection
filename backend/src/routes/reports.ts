import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { requireValidBranchContext } from '../middleware/requireValidBranchContext';
import { scopeFromRequest } from '../middleware/tenantScope';
import { getInspectionsByDate, getInspectionsByVehicle } from '../db/inspections';
import { getIssues } from '../db/issues';
import { getActiveVehicles } from '../db/vehicles';
import { generateDailyExcel } from '../services/exportService';
import { parseDateParam, parsePositiveIntParam } from '../utils/queryParams';
import type { Inspection, Shift } from '../types';

const router = Router();
router.use(requireAuth, requireRole('jefe_operaciones', 'admin', 'admin_pais', 'admin_global'), requireValidBranchContext);

/** Agrega los contadores del stream de inspecciones de un día/turno. */
function countInspections(inspections: Inspection[]) {
  return inspections.reduce(
    (acc, i) => {
      if (i.status === 'reviewed_ok' || i.status === 'reviewed_observation') acc.reviewed++;
      if (i.status === 'serious_issue') acc.issues++;
      if (i.status === 'not_returned')  acc.notReturned++;
      if (i.status === 'other')         acc.other++;
      return acc;
    },
    { total: inspections.length, reviewed: 0, issues: 0, notReturned: 0, other: 0 },
  );
}

// Reporte diario (todos los turnos del día) o de un turno específico (?shift=).
router.get('/daily', async (req, res, next) => {
  try {
    const date  = parseDateParam(req.query.date, new Date().toISOString().split('T')[0]);
    const shift = req.query.shift as Shift | undefined;
    const scope = scopeFromRequest(req);
    const inspections = await getInspectionsByDate(date, scope, shift);
    const guardNames  = [...new Set(inspections.map(i => i.guardName))];
    res.json({
      success: true, statusCode: 'OK', message: 'Reporte diario.', uiState: 'saved_successfully',
      data: { date, shift: shift ?? null, guardNames, inspections, counts: countInspections(inspections) },
    });
  } catch (err) { next(err); }
});

router.get('/vehicle/:vehicleId', async (req, res, next) => {
  try {
    const inspections = await getInspectionsByVehicle(req.params.vehicleId, scopeFromRequest(req));
    res.json({ success: true, statusCode: 'OK', message: 'Historial.', uiState: 'saved_successfully', data: inspections });
  } catch (err) { next(err); }
});

router.get('/open-issues', async (req, res, next) => {
  try {
    const issues = await getIssues({ status: 'open' }, scopeFromRequest(req));
    res.json({ success: true, statusCode: 'OK', message: 'Problemas abiertos.', uiState: 'saved_successfully', data: issues });
  } catch (err) { next(err); }
});

router.get('/no-review', async (req, res, next) => {
  try {
    const thresholdDays = parsePositiveIntParam(req.query.days, 3, 365);
    const cutoff        = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);
    const all      = await getActiveVehicles(scopeFromRequest(req));
    const vehicles = all.filter(v =>
      !v.lastInspectionDate || new Date(v.lastInspectionDate) <= cutoff
    );
    res.json({ success: true, statusCode: 'OK', message: `${vehicles.length} vehículo(s) sin revisión reciente.`, uiState: 'saved_successfully', data: vehicles });
  } catch (err) { next(err); }
});

router.get('/export/daily', async (req, res, next) => {
  try {
    const date   = parseDateParam(req.query.date, new Date().toISOString().split('T')[0]);
    const shift  = req.query.shift as Shift | undefined;
    const buffer = await generateDailyExcel(date, scopeFromRequest(req), shift);
    res.setHeader('Content-Disposition', `attachment; filename="reporte_${date}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) { next(err); }
});

export default router;
