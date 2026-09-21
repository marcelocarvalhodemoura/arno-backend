import './env';
import { ensureTestDatabase } from './ensure-db';
import { TEST_ADMIN_USER, TEST_PASSWORD, TEST_TREASURER_USER } from './credentials';

export default async function globalSetup() {
  await ensureTestDatabase();
  const { waitForDb, getPool } = await import('../../src/shared/db');
  const { migrate } = await import('../../src/shared/database/migrate');
  const { seedIfEmpty } = await import('../../src/shared/persistence/finance-store');
  const { hashPassword } = await import('../../src/shared/auth/password');

  await waitForDb(10);
  await migrate();
  await seedIfEmpty();
  await getPool().query('UPDATE users SET password_hash = $1 WHERE username = ANY($2)', [
    await hashPassword(TEST_PASSWORD),
    [TEST_ADMIN_USER, TEST_TREASURER_USER],
  ]);
  await getPool().end();
}
