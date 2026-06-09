import { Request, Response, NextFunction } from 'express';
import sql from 'mssql';
import { getPool, txStorage } from '../db/connection';
import { runWithSettingsCache } from '../db/settings';

/**
 * Opens a SQL Server transaction for each HTTP request and makes it available
 * to all DB calls within that request via AsyncLocalStorage (txStorage).
 *
 * This is the foundation of two guarantees:
 *
 *   1. Row-Level Security — pinning all queries to a single connection lets
 *      SESSION_CONTEXT (set by setTenantContext in auth.ts) survive across the
 *      multiple sql.Request() invocations a handler makes.
 *
 *   2. Atomicity — the whole request is ONE transaction. It commits only when
 *      the handler produced a successful response (HTTP < 400) and rolls back
 *      on any error status or if the client aborts mid-flight. A handler that
 *      writes several rows and then fails can no longer leave partial data
 *      committed.
 *
 * Lifecycle:
 *   1. Transaction begins → stored in txStorage via AsyncLocalStorage.run().
 *   2. SESSION_CONTEXT is zeroed so stale values from a previous request on the
 *      same pooled connection cannot leak through. If this fails the connection
 *      is unsafe for RLS, so we fail closed (abort the request) rather than run
 *      unscoped queries.
 *   3. requireAuth (per route) calls setTenantContext() to set the real scope.
 *   4. On response finish → commit if status < 400, otherwise roll back.
 *      On response close before finish (client abort) → roll back.
 *
 * Must be registered BEFORE all API routes in app.ts.
 */
export async function dbContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let p: sql.ConnectionPool;
  try {
    p = await getPool();
  } catch (err) {
    next(err);
    return;
  }

  const tx = new sql.Transaction(p);
  try {
    await tx.begin();
  } catch (err) {
    next(err);
    return;
  }

  // Zero-out SESSION_CONTEXT so no stale values survive from the previous
  // request that used this pooled connection. If sp_set_session_context is
  // unavailable, RLS cannot be enforced on this connection — fail closed.
  try {
    await new sql.Request(tx).query(`
      DECLARE @zero BIT = 0;
      EXEC sp_set_session_context N'CtxBranchId',  NULL;
      EXEC sp_set_session_context N'CtxCountryId', NULL;
      EXEC sp_set_session_context N'CtxIsGlobal',  @zero;
    `);
  } catch (err) {
    await tx.rollback().catch(() => {});
    next(err);
    return;
  }

  // Settle the transaction exactly once. The first lifecycle event wins:
  //   - finish (response fully sent) → commit on success, roll back on error.
  //   - close before finish (client aborted) → roll back.
  let settled = false;
  const settle = (commit: boolean): void => {
    if (settled) return;
    settled = true;
    const op = commit ? tx.commit() : tx.rollback();
    op.catch(e => console.error(`[rls] transaction ${commit ? 'commit' : 'rollback'} error:`, e.message));
  };
  res.on('finish', () => settle(res.statusCode < 400));
  res.on('close',  () => settle(false));

  // Both stores active for the request: the pinned transaction (txStorage) and
  // a fresh per-request settings cache (runWithSettingsCache).
  txStorage.run(tx, () => runWithSettingsCache(next));
}
