/**
 * Unit tests for applyScopeWhere — the tenant-isolation SQL fragment builder.
 *
 * These tests exercise the REAL implementation (no jest.mock of scopeUtils),
 * because the whole point is to verify the column allowlist that protects the
 * one part of applyScopeWhere reaching SQL as raw text. The function never
 * touches the DB — it only binds params onto the passed Request and returns a
 * string — so a lightweight Request stub suffices and no connection mock is
 * needed.
 */
import sql from 'mssql';
import { applyScopeWhere } from '../db/scopeUtils';
import type { ScopeColumn } from '../db/scopeUtils';
import type { TenantScope } from '../types';

/**
 * Minimal stand-in for sql.Request: applyScopeWhere only ever calls
 * `.input(name, type, value)` (chainable). We record what gets bound so the
 * tests can assert that the scope *value* is parameterized — never inlined.
 */
function makeReq() {
  const bound: Record<string, unknown> = {};
  const input = jest.fn();
  const req = { input } as unknown as sql.Request;
  input.mockImplementation((name: string, _type: unknown, value: unknown) => {
    bound[name] = value;
    return req;
  });
  return { req, bound, input };
}

const branchScope: TenantScope  = { kind: 'branch',  branchId: 7 };
const countryScope: TenantScope = { kind: 'country', countryId: 3 };
const globalScope: TenantScope  = { kind: 'global' };

describe('applyScopeWhere — scope clauses', () => {
  it('branch scope filters on the default BranchId column and binds scopeBranchId', () => {
    const { req, bound, input } = makeReq();
    const clause = applyScopeWhere(req, branchScope);
    expect(clause).toBe('BranchId = @scopeBranchId');
    expect(input).toHaveBeenCalledWith('scopeBranchId', sql.Int, 7);
    expect(bound.scopeBranchId).toBe(7);
  });

  it('country scope filters via the active-branches subquery and binds scopeCountryId', () => {
    const { req, bound } = makeReq();
    const clause = applyScopeWhere(req, countryScope);
    expect(clause).toBe(
      'BranchId IN (SELECT Id FROM Branches WHERE CountryId = @scopeCountryId AND Active = 1)',
    );
    expect(bound.scopeCountryId).toBe(3);
  });

  it('global scope returns 1=1 and binds nothing', () => {
    const { req, input } = makeReq();
    const clause = applyScopeWhere(req, globalScope);
    expect(clause).toBe('1=1');
    expect(input).not.toHaveBeenCalled();
  });

  it('country scope honors an allowlisted alias in the subquery', () => {
    const { req } = makeReq();
    const clause = applyScopeWhere(req, countryScope, 'v.BranchId');
    expect(clause).toBe(
      'v.BranchId IN (SELECT Id FROM Branches WHERE CountryId = @scopeCountryId AND Active = 1)',
    );
  });
});

describe('applyScopeWhere — column allowlist (every production caller)', () => {
  // The exact identifiers passed by current callers across the codebase
  // (db/{vehicles,issues,inspections,users,drivers}.ts).
  const validCases: ReadonlyArray<[ScopeColumn, string]> = [
    ['BranchId',   'BranchId = @scopeBranchId'],
    ['v.BranchId', 'v.BranchId = @scopeBranchId'],
    ['i.BranchId', 'i.BranchId = @scopeBranchId'],
    ['u.BranchId', 'u.BranchId = @scopeBranchId'],
  ];

  it.each(validCases)('accepts whitelisted column %s', (col, expected) => {
    const { req } = makeReq();
    expect(applyScopeWhere(req, branchScope, col)).toBe(expected);
  });
});

describe('applyScopeWhere — fails closed on non-allowlisted identifiers (SQL injection guard)', () => {
  const payloads: string[] = [
    'BranchId; DROP TABLE Vehicles--',
    'BranchId = 1 OR 1=1',
    '(SELECT TOP 1 PasswordHash FROM Users)',
    '1=1) UNION SELECT * FROM Users--',
    'v.BranchId/**/',  // not an exact allowlist match
    'BranchID',        // wrong casing — allowlist is exact-match
    'b.Id',            // plausible but unused identifier
    '',                // empty
  ];

  it.each(payloads)('throws and binds nothing for %j', (payload) => {
    const { req, input } = makeReq();
    // Cast through `unknown` to simulate an `any`-typed / non-TS caller that
    // bypassed the ScopeColumn compile-time type.
    expect(() =>
      applyScopeWhere(req, branchScope, payload as unknown as ScopeColumn),
    ).toThrow(/allowlist/);
    // It must fail BEFORE binding any param (and therefore before producing SQL).
    expect(input).not.toHaveBeenCalled();
  });

  it('the rejected identifier never reaches a returned clause', () => {
    const { req } = makeReq();
    const payload = 'BranchId; DROP TABLE Vehicles--';
    let clause = '';
    try {
      clause = applyScopeWhere(req, branchScope, payload as unknown as ScopeColumn);
    } catch {
      /* expected */
    }
    expect(clause).toBe('');
    expect(clause).not.toContain('DROP TABLE');
  });

  it('does not leak the offending identifier to clients (plain Error, not AppError)', () => {
    const { req } = makeReq();
    let thrown: unknown;
    try {
      applyScopeWhere(req, branchScope, 'evil' as unknown as ScopeColumn);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    // Not an AppError: AppError carries a numeric statusCode the errorHandler
    // would surface to the client. A plain Error maps to a generic 500.
    expect((thrown as { statusCode?: unknown }).statusCode).toBeUndefined();
  });
});
