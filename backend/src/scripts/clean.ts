/**
 * Clean script — borra todos los datos operacionales de la BD.
 *
 * Se PRESERVA la estructura estática:
 *   Countries, Branches, Settings globales (BranchId IS NULL)
 *
 * Se BORRA todo lo demás en el orden correcto para respetar las FK:
 *   Photos → AuditLogs → OpenIssues → VehicleStatusLog → Inspections
 *   → Settings de sucursal → Vehicles → Drivers → Users
 *
 * También limpia los archivos de fotos del directorio uploads/.
 *
 * Uso: npm run db:clean
 *
 * Nota RLS: el script establece CtxIsGlobal=1 via withScriptContext() para que
 * las políticas FILTER/BLOCK no bloqueen las operaciones. Si se corre como
 * db_owner (sa) las políticas se omiten automáticamente.
 */
import 'dotenv/config';
import path from 'path';
import fs   from 'fs';
import { getPool, getConn, closePool, withScriptContext } from '../db/connection';

// Orden estricto: hijo antes que padre para evitar errores de FK.
// Cada entrada: [tabla, condición WHERE opcional]
const CLEAN_STEPS: [string, string?][] = [
  ['Photos'],
  ['AuditLogs'],
  ['OpenIssues'],
  ['VehicleStatusLog'],
  ['Inspections'],
  ['Settings', 'BranchId IS NOT NULL'],   // solo overrides por sucursal; los globales se conservan
  ['Vehicles'],
  ['Drivers'],
  ['Users'],
];

function cleanUploads(): void {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    console.log('   [skip] directorio uploads/ no existe');
    return;
  }

  let count = 0;
  function removeDir(dir: string) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        removeDir(full);
        fs.rmdirSync(full);
      } else if (entry !== '.gitkeep') {
        fs.unlinkSync(full);
        count++;
      }
    }
  }

  removeDir(uploadsDir);
  console.log(`   [ok] uploads/: ${count} archivo(s) eliminado(s)`);
}

async function main() {
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║   LIMPIEZA DE BASE DE DATOS           ║');
  console.log('╚═══════════════════════════════════════╝\n');

  await getPool(); // inicializa el pool antes de withScriptContext

  await withScriptContext(async () => {
    console.log('Eliminando datos operacionales...\n');
    for (const [table, where] of CLEAN_STEPS) {
      const clause = where ? ` WHERE ${where}` : '';
      const result = await getConn().query(`DELETE FROM ${table}${clause}`);
      const rows   = result.rowsAffected[0] ?? 0;
      const label  = where ? `${table} (${where})` : table;
      console.log(`   [ok] ${label.padEnd(45)} ${rows} fila(s)`);
    }
  });

  console.log('\nLimpiando archivos de fotos...');
  cleanUploads();

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  LIMPIEZA COMPLETADA                                      ║');
  console.log('║                                                           ║');
  console.log('║  Conservado: Countries · Branches · Settings globales     ║');
  console.log('║  Ejecuta "npm run db:seed" para cargar datos de prueba.   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  await closePool();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n[ERROR] Falló la limpieza:', err.message ?? err);
  await closePool();
  process.exit(1);
});
