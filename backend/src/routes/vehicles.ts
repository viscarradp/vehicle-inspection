import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireValidBranchContext } from '../middleware/requireValidBranchContext';
import { requireRole } from '../middleware/roles';
import { scopeFromRequest } from '../middleware/tenantScope';
import { getActiveVehicles, getAllVehicles, getVehicleById } from '../db/vehicles';
import { getInspectionsByVehicle } from '../db/inspections';
import { getOpenIssuesByVehicle } from '../db/issues';
import { updateVehicleStatus, getUnseen } from '../controllers/vehicleStatusController';

const router = Router();
router.use(requireAuth);
router.use(requireValidBranchContext);

router.get('/', async (req, res, next) => {
  try {
    const scope    = scopeFromRequest(req);
    const vehicles = req.query.all === '1' ? await getAllVehicles(scope) : await getActiveVehicles(scope);
    res.json({ success: true, statusCode: 'OK', message: `${vehicles.length} vehículo(s).`, uiState: 'saved_successfully', data: vehicles });
  } catch (err) { next(err); }
});

// Monitor suave de completitud (supervisión). Antes de /:id para no colisionar.
router.get('/unseen', requireRole('jefe_operaciones', 'admin', 'admin_pais', 'admin_global'), getUnseen);

// Cambio de estado persistente del vehículo (guardia + supervisores).
router.patch('/:id/status', updateVehicleStatus);

router.get('/:id', async (req, res, next) => {
  try {
    const scope   = scopeFromRequest(req);
    const vehicle = await getVehicleById(req.params.id, scope);
    if (!vehicle) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Vehículo no encontrado.', uiState: 'not_found' });
      return;
    }
    res.json({ success: true, statusCode: 'OK', message: 'Vehículo encontrado.', uiState: 'saved_successfully', data: vehicle });
  } catch (err) { next(err); }
});

router.get('/:id/history', async (req, res, next) => {
  try {
    const scope   = scopeFromRequest(req);
    const vehicle = await getVehicleById(req.params.id, scope);
    if (!vehicle) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Vehículo no encontrado.', uiState: 'not_found' });
      return;
    }
    const inspections = await getInspectionsByVehicle(req.params.id, scope);
    res.json({ success: true, statusCode: 'OK', message: 'Historial.', uiState: 'saved_successfully', data: inspections });
  } catch (err) { next(err); }
});

router.get('/:id/open-issues', async (req, res, next) => {
  try {
    const scope  = scopeFromRequest(req);
    const issues = await getOpenIssuesByVehicle(req.params.id, scope);
    res.json({ success: true, statusCode: 'OK', message: 'Problemas abiertos.', uiState: 'saved_successfully', data: issues });
  } catch (err) { next(err); }
});

export default router;
