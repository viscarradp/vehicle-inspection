import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireValidBranchContext } from '../middleware/requireValidBranchContext';
import {
  getGuardDashboard,
  createOrUpdateInspection,
  editInspection,
  getInspection,
  discardDraft,
} from '../controllers/inspectionController';
import { upload, uploadPhoto, getInspectionPhotos } from '../controllers/photoController';

const router = Router();
router.use(requireAuth);

// Dashboard del turno actual (calculado server-side). Antes de /:id.
router.get('/dashboard', requireValidBranchContext, getGuardDashboard);

router.post('/', createOrUpdateInspection);            // registrar/actualizar en el turno actual (guardia)
router.patch('/:id', editInspection);                  // editar por id (supervisor; sellado si turno pasado)
router.delete('/:id', discardDraft);                   // descartar un borrador (solo lifecycleStatus='draft')
router.get('/:id', getInspection);
router.post('/:id/photos', upload.single('photo'), uploadPhoto);
router.get('/:id/photos', getInspectionPhotos);

export default router;
