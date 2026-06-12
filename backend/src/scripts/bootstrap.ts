/**
 * bootstrap.ts — Inicializa una base de datos SQL Server vacía para DESARROLLO.
 *
 * Aplica, como `sa`, los scripts de creación del repositorio en orden:
 *   1. database/Operaciones.sql      → schema, datos semilla de catálogos, RLS
 *   2. database/create-app-user.sql  → login/usuario no privilegiado vi_app
 *
 * Lo usa el servicio `db-init` de docker-compose.dev.yml contra el contenedor
 * `db` (azure-sql-edge). Es idempotente: re-ejecutarlo no rompe nada (los scripts
 * usan IF NOT EXISTS / CREATE OR ALTER / DROP IF EXISTS).
 *
 * Por qué un script Node y no sqlcmd: el driver `mssql` es JS puro (multi-arch,
 * nativo en Apple Silicon y en Intel) y evita depender de la imagen de mssql-tools,
 * que solo publica amd64. Divide cada archivo en los lotes separados por `GO`
 * (directiva de sqlcmd, no T-SQL) y los ejecuta sobre una única conexión.
 *
 * Variables de entorno:
 *   MSSQL_HOST           host del SQL Server (en compose: `db`)
 *   MSSQL_PORT           puerto (1433)
 *   MSSQL_SA_PASSWORD    contraseña de `sa` para el bootstrap
 *   SQL_DIR              carpeta con los .sql (en compose: /app/database)
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sql from 'mssql';

const HOST        = process.env.MSSQL_HOST ?? 'localhost';
const PORT        = parseInt(process.env.MSSQL_PORT ?? '1433', 10);
const SA_PASSWORD = process.env.MSSQL_SA_PASSWORD;
const SQL_DIR     = process.env.SQL_DIR ?? join(process.cwd(), '..', 'database');

const FILES = ['Operaciones.sql', 'create-app-user.sql'] as const;

if (!SA_PASSWORD) {
  console.error('[bootstrap] Define MSSQL_SA_PASSWORD antes de ejecutar.');
  process.exit(1);
}

/** Divide un script en los lotes separados por una línea que sea exactamente `GO`. */
function splitBatches(text: string): string[] {
  return text
    .split(/^\s*GO\s*$/gim)
    .map(b => b.trim())
    .filter(b => b.length > 0);
}

/** Conecta como `sa` a `master`, reintentando mientras el contenedor de DB arranca. */
async function connectWithRetry(attempts = 40, delayMs = 2000): Promise<sql.ConnectionPool> {
  const config: sql.config = {
    server: HOST,
    port: PORT,
    user: 'sa',
    password: SA_PASSWORD,
    database: 'master',
    // max:1 → todos los lotes corren sobre la MISMA conexión, así `USE Operaciones`
    // persiste para los lotes siguientes (clave para create-app-user.sql).
    pool: { max: 1, min: 1, idleTimeoutMillis: 60_000 },
    options: { encrypt: false, trustServerCertificate: true },
  };
  for (let i = 1; i <= attempts; i++) {
    try {
      return await new sql.ConnectionPool(config).connect();
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`[bootstrap] esperando a SQL Server (${i}/${attempts})… ${msg}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('[bootstrap] SQL Server no aceptó conexiones a tiempo.');
}

async function run(): Promise<void> {
  const pool = await connectWithRetry();
  console.log('[bootstrap] conectado como sa.');

  for (const file of FILES) {
    const text    = readFileSync(join(SQL_DIR, file), 'utf8');
    const batches = splitBatches(text);
    console.log(`\n[bootstrap] ▶ ${file} — ${batches.length} lote(s)`);
    for (const [idx, batch] of batches.entries()) {
      try {
        await pool.request().batch(batch);
      } catch (err) {
        // Idempotencia de desarrollo: en re-ejecuciones algunos lotes ya existen.
        // Se avisa y se continúa; los scripts están escritos para tolerarlo.
        console.warn(`[bootstrap]   lote ${idx + 1}/${batches.length} aviso: ${(err as Error).message}`);
      }
    }
  }

  await pool.close();
  console.log('\n[bootstrap] ✅ base de datos inicializada.');
}

run().catch(err => {
  console.error('[bootstrap] ❌', err);
  process.exit(1);
});
