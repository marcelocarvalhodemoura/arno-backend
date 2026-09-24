import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { disconnectDb, prisma, waitForDb } from '../db';
import { seedIfEmpty } from '../persistence/finance-store';
import { cleanupDuplicateTransactions } from '../../statement/cleanup-duplicates';

const execFileAsync = promisify(execFile);
const INIT_MIGRATION = '20260921170000_init';

async function runPrisma(args: string[]): Promise<void> {
  const bin = join(process.cwd(), 'node_modules', '.bin', 'prisma');
  await execFileAsync(bin, args, {
    cwd: process.cwd(),
    env: process.env,
  });
}

export async function migrate(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ has_users: boolean; has_prisma: boolean }>>`
    SELECT
      to_regclass('public.users') IS NOT NULL AS has_users,
      to_regclass('public._prisma_migrations') IS NOT NULL AS has_prisma
  `;
  const state = rows[0];
  if (state?.has_users && !state.has_prisma) {
    const ready = await prisma.$queryRaw<Array<{ ready: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'movement_types'
          AND column_name = 'branch'
      ) AS ready
    `;
    if (!ready[0]?.ready) {
      throw new Error(
        'O banco já tem tabelas, mas falta o schema atual. Use um banco vazio para o Prisma criar as tabelas.',
      );
    }
    await runPrisma(['migrate', 'resolve', '--applied', INIT_MIGRATION]);
  }
  await runPrisma(['migrate', 'deploy']);
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS schema_migrations');
}

async function runCli() {
  await waitForDb();
  await migrate();
  await seedIfEmpty();
  const cleaned = await cleanupDuplicateTransactions();
  if (cleaned.deleted > 0) {
    console.log(`Higienização: ${cleaned.deleted} lançamento(s) duplicado(s) removido(s)`);
  }
  console.log('Migrations em dia.');
  await disconnectDb();
}

const isCli = process.argv[1]?.includes('migrate');
if (isCli) {
  runCli().catch(async (error) => {
    console.error(error);
    try {
      await disconnectDb();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
