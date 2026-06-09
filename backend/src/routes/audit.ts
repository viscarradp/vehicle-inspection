import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { requireValidBranchContext } from '../middleware/requireValidBranchContext';
import { scopeFromRequest } from '../middleware/tenantScope';
import { getAuditLogs } from '../db/audit';

const router = Router();
// requireValidBranchContext rejects an out-of-scope ?branchId before it can be
// used to read another tenant's audit trail.
router.use(
  requireAuth,
  requireRole('jefe_operaciones', 'admin', 'admin_pais', 'admin_global'),
  requireValidBranchContext,
);

router.get('/', async (req, res, next) => {
  try {
    const { entity, entityId } = req.query;
    const logs = await getAuditLogs(
      {
        entity:   entity   as string | undefined,
        entityId: entityId as string | undefined,
      },
      scopeFromRequest(req),
    );
    res.json({ success: true, statusCode: 'OK', message: `${logs.length} registro(s).`, uiState: 'saved_successfully', data: logs });
  } catch (err) { next(err); }
});

export default router;
