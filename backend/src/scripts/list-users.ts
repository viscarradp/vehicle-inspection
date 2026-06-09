import 'dotenv/config';
import { getPool, getConn } from '../db/connection';

async function listUsers() {
  try {
    await getPool();
    const result = await getConn().query('SELECT Id, Username, FullName, Role, Active FROM Users ORDER BY Role, Username');
    console.log('Available users:');
    console.table(result.recordset);
    process.exit(0);
  } catch (err: any) {
    console.error('Failed to fetch users:', err.message);
    if (err.message.includes('Login failed')) {
      console.log('\nTip: Check your MSSQL_PASSWORD in .env');
    }
    process.exit(1);
  }
}

listUsers();
