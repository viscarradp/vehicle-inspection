import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getGuardDashboard,
  createOrUpdateInspection,
  editInspection,
  getInspection,
} from '../controllers/inspectionController';
import { upload, uploadPhoto, getInspectionPhotos } from '../controllers/photoController';

const router = Router();
router.use(requireAuth);

// Dashboard del turno actual (calculado server-side). Antes de /:id.
router.get('/dashboard', getGuardDashboard);

router.post('/', createOrUpdateInspection);            // registrar/actualizar en el turno actual (guardia)
router.patch('/:id', editInspection);                  // editar por id (supervisor; sellado si turno pasado)
router.get('/:id', getInspection);
router.post('/:id/photos', upload.single('photo'), uploadPhoto);
router.get('/:id/photos', getInspectionPhotos);

export default router;
