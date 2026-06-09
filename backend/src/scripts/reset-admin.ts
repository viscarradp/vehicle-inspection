/**
 * Resets (or sets) the password for the global admin user.
 *
 * Run: npx tsx src/scripts/reset-admin.ts [password]
 * Default password: admin1234
 */
import 'dotenv/config';
import sql from 'mssql';
import bcrypt from 'bcryptjs';
import { getPool, getConn, closePool } from '../db/connection';

async function main() {
  const password = process.argv[2] ?? 'admin1234';
  const hash     = await bcrypt.hash(password, 12);
  const now      = new Date().toISOString();

  await getPool();
  const req = getConn();
  req.input('hash', sql.NVarChar(255), hash);
  req.input('now',  sql.NVarChar(50),  now);
  const result = await req.query(
    `UPDATE Users SET PasswordHash = @hash, UpdatedAt = @now WHERE Username = 'admin'`,
  );

  if (result.rowsAffected[0] === 0) {
    console.log('No admin user found. Run database/Operaciones.sql first.');
  } else {
    console.log('Admin password updated.');
    console.log(`Username: admin | Password: ${password}`);
  }

  await closePool();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
