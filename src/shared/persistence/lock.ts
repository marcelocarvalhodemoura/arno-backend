import type { Prisma } from '@prisma/client';

/**
 * Trava única das escritas financeiras. O `mutate()` e o `UnitOfWork` pegam a mesma trava, então uma gravação
 * pontual nunca corre junto com uma regravação completa enquanto as duas convivem.
 */
export const FINANCE_LOCK = 87123001;

export async function takeFinanceLock(client: Prisma.TransactionClient) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${FINANCE_LOCK} AS bigint))`;
}
