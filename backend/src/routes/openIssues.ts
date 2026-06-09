import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { listOpenIssues, getOpenIssue, updateIssueStatus, closeIssue } from '../controllers/openIssueController';

const router = Router();
router.use(requireAuth);

// Issue management is a supervisory function — guardias detect issues via the
// inspection flow; reading and resolving them requires at least jefe_operaciones.
router.use(requireRole('jefe_operaciones', 'admin', 'admin_pais', 'admin_global'));

router.get('/',           listOpenIssues);
router.get('/:id',        getOpenIssue);
router.put('/:id/status', updateIssueStatus);
router.post('/:id/close', closeIssue);

export default router;
