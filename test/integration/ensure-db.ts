import pg from 'pg';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('Defina DATABASE_URL (ou DATABASE_ADMIN_URL) para criar o banco de teste.');
}
const TEST_DB = 'tesouraria_test';

export async function ensureTestDatabase() {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (!rows.length) {
      await client.query(`CREATE DATABASE ${TEST_DB}`);
    }
  } finally {
    await client.end();
  }
}
