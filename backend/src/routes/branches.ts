import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { scopeFromRequest } from '../middleware/tenantScope';
import { assertResourceInScope } from '../db/scopeUtils';
import {
  getBranches,
  getBranchById,
  createBranch,
  updateBranch,
  setBranchActive,
} from '../db/branches';

const router = Router();
router.use(requireAuth);

// Only admin_pais and admin_global can write to branches.
const requireBranchAdmin = requireRole('admin_pais', 'admin_global');

// ─── Read ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const scope           = scopeFromRequest(req);
    const filterCountryId = req.query.countryId ? parseInt(req.query.countryId as string, 10) : undefined;
    const branches        = await getBranches(scope, filterCountryId);
    res.json({ success: true, statusCode: 'OK', message: `${branches.length} sucursal(es).`, uiState: 'saved_successfully', data: branches });
  } catch (err) { next(err); }
});

// ─── Write ────────────────────────────────────────────────────────────────────

router.post('/', requireBranchAdmin, async (req, res, next) => {
  try {
    const { code, name, address } = req.body;
    const actor = req.user!;

    if (!code || !name) {
      res.status(400).json({ success: false, statusCode: 'MISSING_FIELDS', message: 'Código y nombre son obligatorios.', uiState: 'validation_error' });
      return;
    }

    // Resolve the countryId for the new branch.
    // admin_pais: always their own country — they cannot create branches in foreign countries.
    // admin_global: must specify countryId in the body.
    let countryId: number;
    if (actor.role === 'admin_pais') {
      countryId = actor.countryId!;
    } else {
      // admin_global
      if (!req.body.countryId) {
        res.status(400).json({ success: false, statusCode: 'MISSING_COUNTRY', message: 'Se requiere especificar un país.', uiState: 'validation_error' });
        return;
      }
      countryId = parseInt(req.body.countryId, 10);
    }

    const branch = await createBranch({ countryId, code, name, address: address ?? null });
    res.status(201).json({ success: true, statusCode: 'BRANCH_CREATED', message: 'Sucursal creada.', uiState: 'saved_successfully', data: branch });
  } catch (err) { next(err); }
});

router.put('/:id', requireBranchAdmin, async (req, res, next) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const branch = await getBranchById(id);

    // assertResourceInScope with branch.id: for country scope it checks that
    // the branch's countryId matches the actor's countryId — the correct guard.
    await assertResourceInScope(branch.id, scopeFromRequest(req));

    const { name, address, code } = req.body;
    await updateBranch(id, { name, address, code });
    res.json({ success: true, statusCode: 'BRANCH_UPDATED', message: 'Sucursal actualizada.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

router.patch('/:id/activate', requireBranchAdmin, async (req, res, next) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const branch = await getBranchById(id);
    await assertResourceInScope(branch.id, scopeFromRequest(req));
    await setBranchActive(id, true);
    res.json({ success: true, statusCode: 'BRANCH_ACTIVATED', message: 'Sucursal activada.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

router.patch('/:id/deactivate', requireBranchAdmin, async (req, res, next) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const branch = await getBranchById(id);
    await assertResourceInScope(branch.id, scopeFromRequest(req));

    // Guard: deactivating a branch that still has active users or vehicles is
    // allowed at the DB level but the UI should warn. The API enforces nothing
    // here — cascading deactivation is a product decision for the frontend.
    await setBranchActive(id, false);
    res.json({ success: true, statusCode: 'BRANCH_DEACTIVATED', message: 'Sucursal desactivada.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

export default router;
