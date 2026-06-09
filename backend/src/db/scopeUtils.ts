import sql from 'mssql';
import { TenantScope } from '../types';
import { getConn } from './connection';
import { AppError } from '../middleware/errorHandler';

/**
 * Appends a branch-scoping WHERE clause fragment and binds the necessary
 * SQL parameters onto `req`.  The caller is responsible for including the
 * returned string in a WHERE (or AND) clause.
 *
 * @param req       - mssql Request to bind params onto
 * @param scope     - resolved TenantScope from the authenticated user
 * @param branchCol - column name to filter on (default: 'BranchId')
 */
export function applyScopeWhere(
  req: sql.Request,
  scope: TenantScope,
  branchCol = 'BranchId',
): string {
  switch (scope.kind) {
    case 'branch':
      req.input('scopeBranchId', sql.Int, scope.branchId);
      return `${branchCol} = @scopeBranchId`;

    case 'country':
      req.input('scopeCountryId', sql.Int, scope.countryId);
      return `${branchCol} IN (SELECT Id FROM Branches WHERE CountryId = @scopeCountryId AND Active = 1)`;

    case 'global':
      return '1=1';
  }
}

/**
 * Verifies that a resource's branchId is within the caller's TenantScope.
 * Throws AppError 403 if it falls outside.
 *
 * Call this in mutation handlers before executing the UPDATE/DELETE.
 *
 * @param resourceBranchId - BranchId of the resource being mutated
 * @param scope            - TenantScope resolved from the authenticated user
 */
export async function assertResourceInScope(
  resourceBranchId: number | null,
  scope:            TenantScope,
): Promise<void> {
  // Global admins can mutate any resource
  if (scope.kind === 'global') return;

  // Resources with no branch (e.g. admin_global users) can only be mutated by global admins
  if (resourceBranchId === null) {
    throw new AppError(403, 'OUTSIDE_SCOPE', 'Este recurso no pertenece a tu scope de administración.');
  }

  if (scope.kind === 'branch') {
    if (resourceBranchId !== scope.branchId) {
      throw new AppError(403, 'OUTSIDE_SCOPE', 'Este recurso no pertenece a tu sucursal.');
    }
    return;
  }

  // kind === 'country' — verify the resource's branch belongs to the scope country
  const req = getConn();
  req.input('branchId',  sql.Int, resourceBranchId);
  req.input('countryId', sql.Int, scope.countryId);
  const result = await req.query(`
    SELECT 1 AS ok FROM Branches
    WHERE Id = @branchId AND CountryId = @countryId AND Active = 1
  `);
  if (!result.recordset.length) {
    throw new AppError(403, 'OUTSIDE_SCOPE', 'Este recurso no pertenece a tu país.');
  }
}
