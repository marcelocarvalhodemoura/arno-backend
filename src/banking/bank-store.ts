import type { BankMovement as BankMovementRow } from '@prisma/client';
import { prisma } from '../shared/db';
import { id } from '../shared/id';
import type { BankMovement, BankMovementStatus } from '../shared/types';

type MovementInput = Omit<BankMovement, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'transactionId'> & {
  status?: BankMovementStatus;
  transactionId?: string;
};

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function asDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function money(value: BankMovementRow['amount']): number {
  return Number(value);
}

function mapMovement(row: BankMovementRow): BankMovement {
  return {
    id: row.id,
    provider: 'sicredi',
    externalId: row.externalId,
    occurredAt: row.occurredAt.toISOString(),
    date: dateOnly(row.date),
    amount: money(row.amount),
    type: row.type === 'expense' ? 'expense' : 'income',
    method: 'pix',
    description: row.description,
    payerName: row.payerName,
    payerDocument: row.payerDocument,
    txid: row.txid,
    status: (row.status as BankMovementStatus) ?? 'new',
    transactionId: row.transactionId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  };
}

export async function upsertBankMovements(items: MovementInput[]) {
  const upserted: BankMovement[] = [];
  for (const item of items) {
    const row = await prisma.bankMovement.upsert({
      where: { externalId: item.externalId },
      create: {
        id: id(),
        provider: item.provider,
        externalId: item.externalId,
        occurredAt: new Date(item.occurredAt),
        date: asDate(item.date),
        amount: item.amount,
        type: item.type,
        method: item.method,
        description: item.description,
        payerName: item.payerName,
        payerDocument: item.payerDocument,
        txid: item.txid,
        status: item.status ?? 'new',
        transactionId: item.transactionId ?? null,
      },
      update: {
        occurredAt: new Date(item.occurredAt),
        date: asDate(item.date),
        amount: item.amount,
        type: item.type,
        description: item.description,
        payerName: item.payerName,
        payerDocument: item.payerDocument,
        txid: item.txid,
        updatedAt: new Date(),
      },
    });
    upserted.push(mapMovement(row));
  }
  return upserted;
}

export async function listBankMovements(from: string, to: string) {
  const rows = await prisma.bankMovement.findMany({
    where: {
      date: { gte: asDate(from), lte: asDate(to) },
    },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(mapMovement);
}

export async function markBankMovement(externalId: string, status: BankMovementStatus, transactionId?: string) {
  const current = await prisma.bankMovement.findUnique({ where: { externalId } });
  if (!current) return undefined;
  const row = await prisma.bankMovement.update({
    where: { externalId },
    data: {
      status,
      transactionId: transactionId ?? current.transactionId,
      updatedAt: new Date(),
    },
  });
  return mapMovement(row);
}

export async function getBankSyncState(provider = 'sicredi') {
  const row = await prisma.bankSyncState.findUnique({ where: { provider } });
  if (!row) {
    return {
      provider,
      lastSyncAt: undefined,
      lastError: undefined,
      lastFrom: undefined,
      lastTo: undefined,
    };
  }
  return {
    provider,
    lastSyncAt: row.lastSyncAt?.toISOString(),
    lastError: row.lastError ?? undefined,
    lastFrom: row.lastFrom ? dateOnly(row.lastFrom) : undefined,
    lastTo: row.lastTo ? dateOnly(row.lastTo) : undefined,
  };
}

export async function saveBankSyncState(input: {
  provider?: string;
  lastSyncAt?: string;
  lastError?: string | null;
  lastFrom?: string;
  lastTo?: string;
}) {
  const provider = input.provider ?? 'sicredi';
  const current = await prisma.bankSyncState.findUnique({ where: { provider } });
  await prisma.bankSyncState.upsert({
    where: { provider },
    create: {
      provider,
      lastSyncAt: input.lastSyncAt ? new Date(input.lastSyncAt) : null,
      lastError: input.lastError ?? null,
      lastFrom: input.lastFrom ? asDate(input.lastFrom) : null,
      lastTo: input.lastTo ? asDate(input.lastTo) : null,
    },
    update: {
      lastSyncAt: input.lastSyncAt ? new Date(input.lastSyncAt) : current?.lastSyncAt,
      lastError: input.lastError ?? null,
      lastFrom: input.lastFrom ? asDate(input.lastFrom) : current?.lastFrom,
      lastTo: input.lastTo ? asDate(input.lastTo) : current?.lastTo,
      updatedAt: new Date(),
    },
  });
  return getBankSyncState(provider);
}
