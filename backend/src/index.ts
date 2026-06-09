import 'dotenv/config';
import { createApp } from './config/app';

// ── Process-level safety net ─────────────────────────────────────────────────
// Route handlers wrap their own errors (try/catch → next), so these are a
// last-resort observability net. An unhandled rejection is logged; an uncaught
// exception leaves the process in an undefined state, so we exit and let the
// orchestrator (Docker/systemd) restart a clean instance.
process.on('unhandledRejection', reason => {
  console.error('[server] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', err => {
  console.error('[server] Uncaught exception:', err);
  process.exit(1);
});

// ── Startup validation — fail fast if required env vars are missing ──
const REQUIRED_ENV = ['JWT_SECRET', 'MSSQL_HOST', 'MSSQL_USER', 'MSSQL_PASSWORD', 'MSSQL_DATABASE'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[server] FATAL: Missing required environment variables: ${missing.join(', ')}`);
  console.error('[server] Copy .env.example to .env and fill in all required values.');
  process.exit(1);
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error('[server] FATAL: JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGIN) {
  console.warn('[server] WARNING: ALLOWED_ORIGIN is not set. CORS will block all browser requests in production.');
}

const PORT = parseInt(process.env.PORT ?? '3001', 10);

async function main() {
  // Verify DB connection before accepting traffic
  const { getPool } = await import('./db/connection');
  try {
    await getPool();
    console.log(`[db] Connected to SQL Server — ${process.env.MSSQL_HOST}/${process.env.MSSQL_DATABASE}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[db] FATAL: Cannot connect to SQL Server:', msg);
    process.exit(1);
  }

  // ── RLS safety self-test ────────────────────────────────────────────────────
  // SQL Server SILENTLY ignores every Row-Level Security policy for db_owner /
  // sysadmin logins — that would disable all tenant isolation with no runtime
  // error. Verify the app's login is not privileged and that the policies exist
  // and are enabled. Fatal in production; a loud warning elsewhere so local dev
  // (often connected as sa) is not blocked.
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT
        IS_ROLEMEMBER('db_owner')    AS isDbOwner,
        IS_SRVROLEMEMBER('sysadmin') AS isSysadmin,
        (SELECT COUNT(*) FROM sys.security_policies WHERE is_enabled = 1) AS enabledPolicies
    `);
    const { isDbOwner, isSysadmin, enabledPolicies } = r.recordset[0];
    const bypassesRls = isDbOwner === 1 || isSysadmin === 1;
    const isProd      = process.env.NODE_ENV === 'production';

    if (bypassesRls) {
      const msg = '[security] El usuario de BD es db_owner/sysadmin — SQL Server IGNORA toda la Row-Level Security para ese rol; el aislamiento entre sucursales/países queda DESACTIVADO. Use un login dedicado sin esos roles.';
      if (isProd) { console.error(`FATAL: ${msg}`); process.exit(1); }
      console.warn(`WARNING: ${msg} (tolerado solo fuera de producción)`);
    }
    if (enabledPolicies === 0) {
      const msg = '[security] No hay políticas RLS habilitadas. Ejecute database/Operaciones.sql para crearlas antes de servir tráfico.';
      if (isProd) { console.error(`FATAL: ${msg}`); process.exit(1); }
      console.warn(`WARNING: ${msg}`);
    }
    console.log(`[security] RLS self-test — login privilegiado: ${bypassesRls ? 'SÍ' : 'no'}, políticas habilitadas: ${enabledPolicies}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[security] FATAL: RLS self-test falló:', msg);
    process.exit(1);
  }

  const app = createApp();

  app.listen(PORT, () => {
    console.log(`[server] Vehicle Inspection API running on http://localhost:${PORT}`);
    console.log(`[server] Health: http://localhost:${PORT}/health`);
    console.log(`[server] Environment: ${process.env.NODE_ENV ?? 'development'}`);
    if (process.env.NODE_ENV === 'production') {
      console.log(`[server] Allowed origin: ${process.env.ALLOWED_ORIGIN ?? '(not set)'}`);
    }
  });
}

main().catch(err => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
