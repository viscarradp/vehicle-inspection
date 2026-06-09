import sql from 'mssql';
import { TenantScope } from '../types';
import { getConn } from './connection';
import { AppError } from '../middleware/errorHandler';

/**
 * The exhaustive allowlist of column identifiers that `applyScopeWhere` is
 * permitted to interpolate into SQL.
 *
 * Why an allowlist and not a bound parameter: the `mssql` driver — like the
 * underlying T-SQL protocol — can only parameterize *values*, never
 * *identifiers* (table/column names). The branch column is therefore the one
 * fragment of `applyScopeWhere` that reaches the query as raw text, which makes
 * it the single SQL-injection surface of the entire tenant-isolation layer.
 *
 * Every entry below is a hardcoded identifier that maps 1:1 to a real BranchId
 * column (bare, or under a fixed query alias). It is the complete set used by
 * every current caller across db/{vehicles,issues,inspections,users,drivers}.ts.
 * To scope a new query, add its alias HERE — never thread a caller- or
 * user-derived string into `branchCol`.
 */
const SCOPE_COLUMNS = [
  'BranchId',   // bare column   — Vehicles, Drivers (default)
  'v.BranchId', // Vehicles  AS v — issues / inspections joins
  'i.BranchId', // Inspections AS i
  'u.BranchId', // Users     AS u
] as const;

/**
 * The compile-time type of an accepted scope column. Annotating `branchCol`
 * with this union makes TypeScript reject any non-whitelisted (or dynamic)
 * identifier across the whole codebase *before* it can ever reach SQL.
 */
export type ScopeColumn = typeof SCOPE_COLUMNS[number];

/**
 * Runtime backstop for the `ScopeColumn` type. Types are erased at runtime, so
 * an `any`-typed value or a non-TypeScript caller could still slip a malicious
 * identifier past the compiler. This guard fails closed.
 *
 * It throws a plain `Error` (never an `AppError`): the global errorHandler maps
 * unknown errors to a generic 500 without echoing the message to the client, so
 * the offending identifier is logged server-side for forensics but never
 * reflected back to a potential attacker. Reaching here is always a bug or an
 * attempted bypass — never legitimate client input.
 */
function assertScopeColumn(branchCol: string): asserts branchCol is ScopeColumn {
  if (!(SCOPE_COLUMNS as readonly string[]).includes(branchCol)) {
    throw new Error(
      `applyScopeWhere: column identifier not in allowlist: ${JSON.stringify(branchCol)}`,
    );
  }
}

/**
 * Appends a branch-scoping WHERE clause fragment and binds the necessary
 * SQL parameters onto `req`.  The caller is responsible for including the
 * returned string in a WHERE (or AND) clause.
 *
 * The scope *value* (branchId / countryId) is always bound as a parameter
 * (`@scopeBranchId` / `@scopeCountryId`) and never interpolated. The scope
 * *column* is constrained to the {@link SCOPE_COLUMNS} allowlist at both compile
 * time ({@link ScopeColumn}) and run time ({@link assertScopeColumn}). Together
 * these guarantee the returned fragment cannot carry attacker-controlled SQL.
 *
 * @param req       - mssql Request to bind params onto
 * @param scope     - resolved TenantScope from the authenticated user
 * @param branchCol - allowlisted column to filter on (default: 'BranchId')
 */
export function applyScopeWhere(
  req: sql.Request,
  scope: TenantScope,
  branchCol: ScopeColumn = 'BranchId',
): string {
  // Defense in depth: enforce the allowlist at run time even though the
  // `ScopeColumn` type already enforces it at compile time.
  assertScopeColumn(branchCol);

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
