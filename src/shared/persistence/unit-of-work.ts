import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { invalidateCache } from './finance-store';
import { takeFinanceLock } from './lock';

export type DbClient = PrismaClient | Prisma.TransactionClient;

const TIMEOUT_MS = 30_000;

/**
 * Uma transação do banco para vários repositórios. Dentro de `run`, todo repositório que usa `client`
 * grava na mesma transação; fora dele, cada chamada é independente.
 */
@Injectable()
export class UnitOfWork {
  private readonly current = new AsyncLocalStorage<Prisma.TransactionClient>();

  get client(): DbClient {
    return this.current.getStore() ?? prisma;
  }

  get active(): boolean {
    return Boolean(this.current.getStore());
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active) return work();
    const result = await prisma.$transaction(
      async (tx) => {
        await takeFinanceLock(tx);
        return this.current.run(tx, work);
      },
      { timeout: TIMEOUT_MS },
    );
    // O cache do mutate() guarda o financeiro inteiro; depois de uma gravação pontual ele precisa ser relido.
    invalidateCache();
    return result;
  }
}

export const unitOfWork = new UnitOfWork();
