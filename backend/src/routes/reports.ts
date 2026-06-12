import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { requireValidBranchContext } from '../middleware/requireValidBranchContext';
import { scopeFromRequest } from '../middleware/tenantScope';
import {
  getInspectionsByDate, getInspectionsByVehicle,
  getInspectionsByDateRange, getRecentInspections,
} from '../db/inspections';
import { getIssues } from '../db/issues';
import { getActiveVehicles, getVehicleById } from '../db/vehicles';
import { generateDailyExcel } from '../services/exportService';
import { generateInspectionsPdf } from '../services/pdfService';
import { parseDateParam, parsePositiveIntParam } from '../utils/queryParams';
import { AppError } from '../middleware/errorHandler';
import type { Inspection, Vehicle, Shift } from '../types';

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

// Descarga de reportes en PDF. Dos modos de filtro (excluyentes):
//   ?last=N            → las N inspecciones más recientes (1..100)
//   ?from=&to=         → inspecciones en el rango de fechas (máx. 92 días)
// Autorización: heredada del router (requireAuth + requireRole admins/jefe_operaciones).
const MAX_PDF_INSPECTIONS = 150;   // techo para acotar el tamaño del documento
const MAX_RANGE_DAYS      = 92;

router.get('/export/pdf', async (req, res, next) => {
  try {
    const scope = scopeFromRequest(req);

    let inspections: Inspection[];
    let subtitle: string;
    let filename: string;

    if (req.query.last !== undefined) {
      // ── Modo "últimos N" ──
      const n = parsePositiveIntParam(req.query.last, 10, 100);
      inspections = await getRecentInspections(scope, n);
      subtitle = `Últimas ${inspections.length} inspecciones`;
      filename = `inspecciones_ultimas_${n}.pdf`;
    } else {
      // ── Modo rango de fechas ──
      const today = new Date().toISOString().split('T')[0];
      const from  = parseDateParam(req.query.from, today);
      const to    = parseDateParam(req.query.to, today);
      if (from > to) {
        throw new AppError(400, 'INVALID_RANGE', "La fecha 'desde' no puede ser posterior a 'hasta'.");
      }
      const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
      if (spanDays > MAX_RANGE_DAYS) {
        throw new AppError(400, 'RANGE_TOO_WIDE', `El rango no puede exceder ${MAX_RANGE_DAYS} días.`);
      }
      inspections = await getInspectionsByDateRange(from, to, scope);
      subtitle = `Del ${from} al ${to}`;
      filename = `inspecciones_${from}_a_${to}.pdf`;
    }

    // Techo de seguridad: evita PDFs gigantes. Se informa en el subtítulo.
    let truncated = false;
    if (inspections.length > MAX_PDF_INSPECTIONS) {
      inspections = inspections.slice(0, MAX_PDF_INSPECTIONS);
      truncated = true;
    }

    // Enriquecer con datos del vehículo (marca/modelo/tipo). Secuencial: la
    // conexión fijada del request no multiplexa queries concurrentes.
    const vehicleById = new Map<string, Vehicle>();
    for (const id of new Set(inspections.map(i => i.vehicleId))) {
      const v = await getVehicleById(id);
      if (v) vehicleById.set(id, v);
    }

    const buffer = await generateInspectionsPdf(inspections, vehicleById, {
      title: 'Reporte de inspecciones',
      subtitle: truncated ? `${subtitle} (mostrando las primeras ${MAX_PDF_INSPECTIONS})` : subtitle,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (err) { next(err); }
});

export default router;
