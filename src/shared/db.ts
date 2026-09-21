import { PrismaClient } from '@prisma/client';
import './env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export const DATABASE_URL = process.env.DATABASE_URL ?? '';

export async function waitForDb(retries = 30): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      lastError = error;
      console.log(`Aguardando PostgreSQL (${i + 1}/${retries})…`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Não foi possível conectar ao PostgreSQL');
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
