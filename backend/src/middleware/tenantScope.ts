import { Request } from 'express';
import { AuthPayload, TenantScope } from '../types';
import { AppError } from './errorHandler';
import { assertResourceInScope } from '../db/scopeUtils';

export function resolveScope(user: AuthPayload, requestedBranchId?: number): TenantScope {
  if (user.role === 'admin_global') {
    return requestedBranchId
      ? { kind: 'branch', branchId: requestedBranchId }
      : { kind: 'global' };
  }

  if (user.role === 'admin_pais') {
    // admin_pais can optionally narrow to a specific branch within their country
    if (requestedBranchId) return { kind: 'branch', branchId: requestedBranchId };
    return { kind: 'country', countryId: user.countryId! };
  }

  // guardia, jefe_operaciones, admin: always scoped to their branch
  return { kind: 'branch', branchId: user.branchId! };
}

export function scopeFromRequest(req: Request): TenantScope {
  const branchParam = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
  return resolveScope(req.user!, isNaN(branchParam!) ? undefined : branchParam);
}

// ─── Explicit scope targeting (settings) ──────────────────────────────────────
//
// Unlike scopeFromRequest (which silently infers from role + optional branchId),
// this parses an EXPLICIT target scope so an actor can address any level they are
// authorized for — e.g. admin_global configuring a specific country. Authorization
// is enforced separately by assertCanAccessScope.

/** The natural scope an actor operates on when no explicit target is given. */
function naturalScope(user: AuthPayload): TenantScope {
  if (user.role === 'admin_global') return { kind: 'global' };
  if (user.role === 'admin_pais')   return { kind: 'country', countryId: user.countryId! };
  return { kind: 'branch', branchId: user.branchId! };
}

/**
 * Parses an explicit target scope from the request:
 *   ?level=global
 *   ?level=country&countryId=2
 *   ?level=branch&branchId=5
 * When `level` is omitted, defaults to the actor's natural scope (avoids the
 * footgun of accidentally writing the global layer).
 * Throws AppError 400 on malformed input. Does NOT authorize — call
 * assertCanAccessScope afterwards.
 */
export function targetScopeFromRequest(req: Request): TenantScope {
  const level     = req.query.level as string | undefined;
  const branchId  = req.query.branchId  ? parseInt(req.query.branchId  as string, 10) : undefined;
  const countryId = req.query.countryId ? parseInt(req.query.countryId as string, 10) : undefined;

  if (level === undefined) return naturalScope(req.user!);

  switch (level) {
    case 'global':
      return { kind: 'global' };
    case 'country':
      if (countryId === undefined || isNaN(countryId)) {
        throw new AppError(400, 'INVALID_SCOPE', "level=country requiere un 'countryId' válido.");
      }
      return { kind: 'country', countryId };
    case 'branch':
      if (branchId === undefined || isNaN(branchId)) {
        throw new AppError(400, 'INVALID_SCOPE', "level=branch requiere un 'branchId' válido.");
      }
      return { kind: 'branch', branchId };
    default:
      throw new AppError(400, 'INVALID_SCOPE', "'level' debe ser 'global', 'country' o 'branch'.");
  }
}

/**
 * Authorizes that `user` may read or write settings at `target`, enforcing
 * tenant containment. Throws AppError 403 if the target is outside the actor's
 * scope. admin_global has unrestricted access.
 *
 *   global  → read: any authenticated role; write: admin_global only
 *   country → admin_pais of that same country (or admin_global)
 *   branch  → admin_pais whose country contains it; admin/jefe/guardia of that
 *             exact branch (writes are further gated by requireRole upstream)
 */
export async function assertCanAccessScope(
  user:   AuthPayload,
  target: TenantScope,
  mode:   'read' | 'write',
): Promise<void> {
  if (user.role === 'admin_global') return;

  switch (target.kind) {
    case 'global':
      if (mode === 'write') {
        throw new AppError(403, 'OUTSIDE_SCOPE', 'Solo admin_global puede modificar la configuración global.');
      }
      return; // reading inherited global values is allowed for any role

    case 'country':
      if (user.role === 'admin_pais' && user.countryId === target.countryId) return;
      throw new AppError(403, 'OUTSIDE_SCOPE', 'Este país no pertenece a tu scope de administración.');

    case 'branch':
      if (user.role === 'admin_pais') {
        // Reuse the canonical "branch belongs to my country" check.
        await assertResourceInScope(target.branchId, { kind: 'country', countryId: user.countryId! });
        return;
      }
      if (user.branchId === target.branchId) return;
      throw new AppError(403, 'OUTSIDE_SCOPE', 'Esta sucursal no pertenece a tu scope de administración.');
  }
}
