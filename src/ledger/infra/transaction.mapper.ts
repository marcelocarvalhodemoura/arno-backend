import type { Prisma } from '@prisma/client';
import type { MonthClosing, Transaction, TrashedTransaction } from '../../shared/types';
import { asDate, asTimestamp, dateOnly, mapAudit, storedOrigin } from '../../shared/persistence/row-mapping';

/** Linha de `transactions` como o Prisma devolve. */
export type TransactionRow = Prisma.TransactionGetPayload<object>;
export type TrashRow = Prisma.TransactionTrashGetPayload<object>;
export type MonthClosingRow = Prisma.MonthClosingGetPayload<object>;

export function toTransactionRow(tx: Transaction): Prisma.TransactionCreateManyInput {
  return {
    id: tx.id,
    date: asDate(tx.date),
    type: tx.type,
    nature: tx.nature,
    movementTypeId: tx.movementTypeId,
    description: tx.description,
    amount: tx.amount,
    branch: tx.branch,
    method: tx.method,
    paymentStatus: tx.paymentStatus === 'pending' ? 'pending' : 'paid',
    paidAt: tx.paidAt ? asDate(tx.paidAt) : null,
    memberId: tx.memberId ?? null,
    memberAccountId: tx.memberAccountId ?? null,
    memberGuardianId: tx.memberGuardianId ?? null,
    projectId: tx.projectId ?? null,
    notes: tx.notes ?? null,
    notaKey: tx.notaKey ?? null,
    notaFileName: tx.notaFileName ?? null,
    notaContentType: tx.notaContentType ?? null,
    externalId: tx.externalId ?? null,
    clubFeeIncluded: tx.clubFeeIncluded ?? null,
    splitGroupId: tx.splitGroupId ?? null,
    splitTotal: tx.splitTotal ?? null,
    splitIndex: tx.splitIndex ?? null,
    splitCount: tx.splitCount ?? null,
    arrearsId: tx.arrearsId ?? null,
    arrearsYearMonth: tx.arrearsYearMonth ?? null,
    createdById: tx.createdBy ?? null,
    createdAt: tx.createdAt ? new Date(tx.createdAt) : new Date(),
    updatedAt: asTimestamp(tx.updatedAt),
    updatedById: tx.updatedBy ?? null,
    origin: storedOrigin(tx.origin, true),
    importSource: tx.importSource ?? null,
    sourceDate: tx.sourceDate ? asDate(tx.sourceDate) : null,
    sourceDescription: tx.sourceDescription ?? null,
    sourceAmount: tx.sourceAmount ?? null,
  };
}

export function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    date: dateOnly(row.date),
    type: row.type as Transaction['type'],
    nature: row.nature as Transaction['nature'],
    movementTypeId: row.movementTypeId,
    description: row.description,
    amount: Number(row.amount),
    branch: row.branch as Transaction['branch'],
    method: row.method as Transaction['method'],
    paymentStatus: row.paymentStatus === 'pending' ? 'pending' : 'paid',
    paidAt: row.paidAt ? dateOnly(row.paidAt) : undefined,
    memberId: row.memberId ?? undefined,
    memberAccountId: row.memberAccountId ?? undefined,
    memberGuardianId: row.memberGuardianId ?? undefined,
    projectId: row.projectId ?? undefined,
    notes: row.notes ?? undefined,
    notaKey: row.notaKey ?? undefined,
    notaFileName: row.notaFileName ?? undefined,
    notaContentType: row.notaContentType ?? undefined,
    externalId: row.externalId ?? undefined,
    clubFeeIncluded: row.clubFeeIncluded ?? undefined,
    splitGroupId: row.splitGroupId ?? undefined,
    splitTotal: row.splitTotal != null ? Number(row.splitTotal) : undefined,
    splitIndex: row.splitIndex ?? undefined,
    splitCount: row.splitCount ?? undefined,
    arrearsId: row.arrearsId ?? undefined,
    arrearsYearMonth: row.arrearsYearMonth ?? undefined,
    importSource:
      row.importSource === 'csv' || row.importSource === 'pdf' || row.importSource === 'sicredi'
        ? row.importSource
        : undefined,
    sourceDate: row.sourceDate ? dateOnly(row.sourceDate) : undefined,
    sourceDescription: row.sourceDescription ?? undefined,
    sourceAmount: row.sourceAmount != null ? Number(row.sourceAmount) : undefined,
    ...mapAudit(row),
  };
}

export function toTrashRow(entry: TrashedTransaction): Prisma.TransactionTrashCreateManyInput {
  return {
    id: entry.id,
    transactionId: entry.transaction.id,
    payload: entry.transaction as unknown as Prisma.InputJsonValue,
    deletedAt: new Date(entry.deletedAt),
    deletedById: entry.deletedBy ?? null,
  };
}

export function toTrashed(row: TrashRow): TrashedTransaction {
  return {
    id: row.id,
    transaction: row.payload as unknown as Transaction,
    deletedAt: row.deletedAt.toISOString(),
    deletedBy: row.deletedById ?? undefined,
  };
}

export function toMonthClosing(row: MonthClosingRow): MonthClosing {
  return {
    yearMonth: row.yearMonth,
    closedAt: row.closedAt.toISOString(),
    closedBy: row.closedById ?? undefined,
    income: Number(row.income),
    expense: Number(row.expense),
    balance: Number(row.balance),
  };
}
