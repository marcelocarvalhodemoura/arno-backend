import type { Barter as BarterRow } from '@prisma/client';
import { prisma } from '../shared/db';
import type { Barter, BarterApplied, BarterStatus } from './barter';

function map(row: BarterRow): Barter {
  return {
    id: row.id,
    memberId: row.memberId ?? undefined,
    donorName: row.donorName,
    service: row.service,
    amount: Number(row.amount),
    serviceDate: row.serviceDate.toISOString().slice(0, 10),
    expenseTypeId: row.expenseTypeId,
    donationTypeId: row.donationTypeId,
    notes: row.notes,
    status: row.status as BarterStatus,
    decisionNote: row.decisionNote,
    coveredAmount: row.coveredAmount == null ? undefined : Number(row.coveredAmount),
    donationAmount: row.donationAmount == null ? undefined : Number(row.donationAmount),
    settledIds: row.settledIds,
    expenseTransactionId: row.expenseTransactionId ?? undefined,
    donationTransactionId: row.donationTransactionId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    createdById: row.createdById ?? undefined,
    decidedAt: row.decidedAt?.toISOString(),
    decidedById: row.decidedById ?? undefined,
  };
}

export async function listBarters(): Promise<Barter[]> {
  const rows = await prisma.barter.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(map);
}

export async function getBarter(id: string): Promise<Barter | null> {
  const row = await prisma.barter.findUnique({ where: { id } });
  return row ? map(row) : null;
}

export async function createBarter(
  input: Pick<
    Barter,
    'memberId' | 'donorName' | 'service' | 'amount' | 'serviceDate' | 'expenseTypeId' | 'donationTypeId' | 'notes'
  >,
  userId: string,
): Promise<Barter> {
  const row = await prisma.barter.create({
    data: {
      memberId: input.memberId ?? null,
      donorName: input.donorName,
      service: input.service,
      amount: input.amount,
      serviceDate: new Date(`${input.serviceDate}T00:00:00Z`),
      expenseTypeId: input.expenseTypeId,
      donationTypeId: input.donationTypeId,
      notes: input.notes,
      createdById: userId,
    },
  });
  return map(row);
}

/** Trava a permuta para a baixa: só uma aprovação passa, mesmo com dois cliques ao mesmo tempo. */
export async function claimPendingBarter(id: string): Promise<boolean> {
  const result = await prisma.barter.updateMany({ where: { id, status: 'pending' }, data: { status: 'approving' } });
  return result.count === 1;
}

export async function releaseBarter(id: string): Promise<void> {
  await prisma.barter.updateMany({ where: { id, status: 'approving' }, data: { status: 'pending' } });
}

export async function markBarterApproved(
  id: string,
  applied: BarterApplied,
  userId: string,
  note: string,
): Promise<Barter> {
  const row = await prisma.barter.update({
    where: { id },
    data: {
      status: 'approved',
      decisionNote: note,
      coveredAmount: applied.coveredAmount,
      donationAmount: applied.donationAmount,
      settledIds: applied.settledIds,
      expenseTransactionId: applied.expenseTransactionId,
      donationTransactionId: applied.donationTransactionId ?? null,
      decidedAt: new Date(),
      decidedById: userId,
    },
  });
  return map(row);
}

export async function rejectPendingBarter(id: string, userId: string, note: string): Promise<boolean> {
  const result = await prisma.barter.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'rejected', decisionNote: note, decidedAt: new Date(), decidedById: userId },
  });
  return result.count === 1;
}
