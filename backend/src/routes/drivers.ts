import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { scopeFromRequest } from '../middleware/tenantScope';
import { getActiveDrivers, getAllDrivers } from '../db/drivers';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const scope   = scopeFromRequest(req);
    // ?all=1 → incluye inactivos (pantalla de administración). Sin el parámetro
    // solo activos (lo que consume el formulario de inspección del guardia).
    const drivers = req.query.all === '1' ? await getAllDrivers(scope) : await getActiveDrivers(scope);
    res.json({ success: true, statusCode: 'OK', message: `${drivers.length} conductor(es).`, uiState: 'saved_successfully', data: drivers });
  } catch (err) { next(err); }
});

export default router;
