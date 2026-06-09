import { Request, Response, NextFunction } from 'express';
import sql from 'mssql';
import { getConn } from '../db/connection';

/**
 * Validates the optional ?branchId query param for roles with restricted scope.
 *
 * - admin_global : any branchId is accepted (no DB check needed)
 * - admin_pais   : branchId must belong to the user's countryId
 * - operational  : ?branchId is ignored — resolveScope will discard it anyway
 *
 * Must run after requireAuth (needs req.user).
 * Only activates when ?branchId is present; passes through otherwise.
 */
export async function requireValidBranchContext(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  const rawParam = req.query.branchId as string | undefined;

  // No param — nothing to validate
  if (!rawParam) { next(); return; }

  const requestedBranchId = parseInt(rawParam, 10);
  if (isNaN(requestedBranchId)) {
    res.status(400).json({
      success:    false,
      statusCode: 'INVALID_BRANCH_PARAM',
      message:    'El parámetro branchId debe ser un número entero.',
      uiState:    'validation_error',
    });
    return;
  }

  const user = req.user!;

  // admin_global can access any branch — skip DB check
  if (user.role === 'admin_global') { next(); return; }

  // Operational roles — the param will be ignored by resolveScope, no validation needed
  const operationalRoles = ['guardia', 'jefe_operaciones', 'admin'];
  if (operationalRoles.includes(user.role)) { next(); return; }

  // admin_pais — verify the requested branch belongs to their country
  if (user.role === 'admin_pais') {
    if (!user.countryId) {
      // Should never happen if P3.B is in place, but guard defensively
      res.status(403).json({
        success:    false,
        statusCode: 'USER_MISCONFIGURED',
        message:    'El usuario admin_pais no tiene país asignado.',
        uiState:    'validation_error',
      });
      return;
    }

    // Reuse the request's pinned connection (getConn) rather than acquiring a
    // second pool connection — Branches isn't RLS-protected, so SESSION_CONTEXT
    // is irrelevant here, and a 2nd connection per request halves pool capacity.
    const dbReq = getConn();
    dbReq.input('branchId',  sql.Int, requestedBranchId);
    dbReq.input('countryId', sql.Int, user.countryId);
    const result = await dbReq.query(`
      SELECT 1 AS ok FROM Branches
      WHERE Id = @branchId AND CountryId = @countryId AND Active = 1
    `);

    if (!result.recordset.length) {
      res.status(403).json({
        success:    false,
        statusCode: 'BRANCH_OUT_OF_SCOPE',
        message:    'La sucursal solicitada no pertenece a tu país o no está activa.',
        uiState:    'unauthorized',
      });
      return;
    }

    next();
    return;
  }

  next();
}
