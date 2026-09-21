import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, waitForDb } from '../db';
import { seedIfEmpty } from '../persistence/finance-store';

function resolveMigrationsDir(): string {
  const candidates = [
    join(process.cwd(), 'migrations'),
    join(__dirname, '../../../migrations'),
    join(__dirname, '../../migrations'),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) {
    throw new Error(`Pasta de migrations não encontrada. Tentativas: ${candidates.join(', ')}`);
  }
  return found;
}

export async function migrate(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set(
    (await pool.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((row) => row.id),
  );

  const migrationsDir = resolveMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Migration aplicada: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function runCli() {
  await waitForDb();
  await migrate();
  await seedIfEmpty();
  console.log('Migrations em dia.');
  await getPool().end();
}

const isCli = process.argv[1]?.includes("migrate");
if (isCli) {
  runCli().catch(async (error) => {
    console.error(error);
    try {
      await getPool().end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
