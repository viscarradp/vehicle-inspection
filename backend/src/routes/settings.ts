import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { getSettings, updateSettings, resetSettings } from '../controllers/settingsController';

const router = Router();

// All routes accept an explicit target scope via query params:
//   ?level=global
//   ?level=country&countryId=2
//   ?level=branch&branchId=5
// When omitted, the actor's natural scope is used. Tenant containment and
// per-setting privilege/lock are enforced inside the controller / db layer.

// ─── GET /settings ────────────────────────────────────────────────────────────
// Effective values (cascade-resolved) + source, writableFrom, overridableTo,
// canEdit, description. Readable by any authenticated role for scopes they contain.
router.get('/', requireAuth, getSettings);

// ─── PUT /settings ────────────────────────────────────────────────────────────
// Body { key: value | null }. null reverts the override to the inherited level.
// jefe_operaciones and guardia have no write access.
router.put('/', requireAuth, requireRole('admin', 'admin_pais', 'admin_global'), updateSettings);

// ─── POST /settings/reset ─────────────────────────────────────────────────────
// Body { keys?: string[] }. Bulk revert to inherited level (omit keys = all).
router.post('/reset', requireAuth, requireRole('admin', 'admin_pais', 'admin_global'), resetSettings);

export default router;
