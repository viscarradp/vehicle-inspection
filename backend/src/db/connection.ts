import sql from 'mssql';
import { AsyncLocalStorage } from 'async_hooks';
import type { AuthPayload } from '../types';

// ─── Connection pool ──────────────────────────────────────────────────────────

const config: sql.config = {
  server:   process.env.MSSQL_HOST     ?? 'localhost',
  port:     parseInt(process.env.MSSQL_PORT ?? '1433', 10),
  database: process.env.MSSQL_DATABASE ?? 'Operaciones',
  user:     process.env.MSSQL_USER     ?? '',
  password: process.env.MSSQL_PASSWORD ?? '',
  options: {
    encrypt:                process.env.MSSQL_ENCRYPT    !== 'false',
    trustServerCertificate: process.env.MSSQL_TRUST_CERT === 'true',
    enableArithAbort: true,
  },
  pool: {
    // Each HTTP request holds one pooled connection for its lifetime — the
    // per-request transaction that carries SESSION_CONTEXT for RLS (see
    // dbContextMiddleware). Sizing rationale: requests are short (indexed reads
    // and small writes), so each connection serves many req/s; 50 comfortably
    // absorbs shift-change peaks for this workload. Raise toward the SQL Server
    // tier's worker-thread budget if load tests show saturation.
    max: 50,
    min: 2,
    idleTimeoutMillis: 30000,
    // Fail fast when the pool is saturated instead of hanging: surfaces as a
    // request error the handler turns into a 500, rather than a silent stall.
    acquireTimeoutMillis: 15000,
  },
  connectionTimeout: 30000,
  requestTimeout:    30000,
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  pool = await new sql.ConnectionPool(config).connect();
  pool.on('error', err => {
    console.error('[db] Pool error:', err.message);
    pool = null;
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

// ─── Per-request transaction context (for RLS) ───────────────────────────────
//
// Each HTTP request opens ONE SQL Server transaction, stored here via
// AsyncLocalStorage. Every DB call within the request runs on that transaction's
// single connection — which is what lets SESSION_CONTEXT (set once by
// setTenantContext after auth) survive across multiple sql.Request() calls, and
// makes the whole request a single atomic unit: it commits on a successful
// response and rolls back on any error (see dbContextMiddleware).
//
// Consequence: never issue two getConn() queries concurrently (e.g. Promise.all)
// — a single connection cannot multiplex requests. Await them sequentially.

export const txStorage = new AsyncLocalStorage<sql.Transaction>();

/**
 * Returns a sql.Request bound to the current request's transaction when one
 * exists, or falls back to a plain pool request (used during server startup,
 * health checks, and code paths outside HTTP requests).
 */
export function getConn(): sql.Request {
  const tx = txStorage.getStore();
  if (tx) return new sql.Request(tx);
  if (!pool || !pool.connected) {
    throw new Error('[db] getConn() called before pool is connected. Ensure getPool() was awaited at startup.');
  }
  return pool.request();
}

// ─── Script context (for CLI scripts that run outside HTTP requests) ─────────
//
// Seed, clean, and other one-off scripts run via `tsx` without Express
// middleware. They have no per-request transaction and no SESSION_CONTEXT, so
// RLS BLOCK predicates would reject INSERTs/UPDATEs and FILTER predicates would
// suppress the rows DELETE/SELECT touch.
//
// withScriptContext() opens a dedicated transaction, sets CtxIsGlobal=1, runs
// the callback with that transaction in txStorage (so every getConn() call uses
// the same connection), and commits when done (rolls back on error).
//
// Usage in scripts:
//   await getPool();
//   await withScriptContext(async () => { /* all DB operations */ });

export async function withScriptContext<T>(fn: () => Promise<T>): Promise<T> {
  const p = await getPool();
  const tx = new sql.Transaction(p);
  await tx.begin();

  const r = new sql.Request(tx);
  r.input('g', sql.Bit, 1);
  await r.query(`
    EXEC sp_set_session_context N'CtxBranchId',  NULL;
    EXEC sp_set_session_context N'CtxCountryId', NULL;
    EXEC sp_set_session_context N'CtxIsGlobal',  @g;
  `);

  return txStorage.run(tx, async () => {
    try {
      const result = await fn();
      await tx.commit();
      return result;
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  });
}

// ─── Tenant SESSION_CONTEXT ───────────────────────────────────────────────────
//
// Called by requireAuth after verifying the JWT. Sets the three SESSION_CONTEXT
// keys on the current request's transaction connection so RLS policies can
// filter rows by the user's scope (branch / country / global).

export async function setTenantContext(user: AuthPayload): Promise<void> {
  const branchId  = user.branchId  ?? null;
  const countryId = user.countryId ?? null;
  const isGlobal  = user.role === 'admin_global';

  const tx = txStorage.getStore();
  if (!tx) return;

  const r = new sql.Request(tx);
  r.input('ctxBranchId',  sql.Int, branchId);
  r.input('ctxCountryId', sql.Int, countryId);
  r.input('ctxIsGlobal',  sql.Bit, isGlobal ? 1 : 0);
  await r.query(`
    EXEC sp_set_session_context N'CtxBranchId',  @ctxBranchId;
    EXEC sp_set_session_context N'CtxCountryId', @ctxCountryId;
    EXEC sp_set_session_context N'CtxIsGlobal',  @ctxIsGlobal;
  `);
}
