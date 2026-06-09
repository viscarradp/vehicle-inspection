import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listVehicleStatusTypes,
  listAllVehicleStatusTypes,
  createStatusType,
  updateStatusType,
  toggleStatusType,
  deleteStatusType,
} from '../controllers/vehicleStatusTypeController';

const router = Router();

router.use(requireAuth);

router.get('/',        listVehicleStatusTypes);     // todos los roles — para poblar dropdowns/badges
router.get('/all',     listAllVehicleStatusTypes);  // admin_pais+ — página de administración
router.post('/',       createStatusType);
router.put('/:id',     updateStatusType);
router.patch('/:id/toggle', toggleStatusType);
router.delete('/:id',  deleteStatusType);

export default router;
