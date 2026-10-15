import { Injectable } from '@nestjs/common';
import { id, isUuid } from '../../shared/id';
import {
  emptyFinance,
  mapAccount,
  mapGuardian,
  mapMember,
  mapMovementType,
  recordHistory,
} from '../../shared/persistence/finance-store';
import { UnitOfWork } from '../../shared/persistence/unit-of-work';
import type { DatabaseShape, FinancialProject, Transaction, TrashedTransaction } from '../../shared/types';
import { assertClosedMonthsUntouched, diffTransactions } from '../governance';
import type { LedgerContextRefs, TransactionRepository } from '../domain/transaction.repository';
import { toMonthClosing, toTransaction, toTransactionRow, toTrashed, toTrashRow } from './transaction.mapper';

/** Ids válidos e sem repetição; um id fora do formato UUID não existe no banco (e o Postgres recusaria a consulta). */
const ids = (list?: (string | undefined)[]) => [
  ...new Set((list ?? []).filter((item): item is string => !!item && isUuid(item))),
];

@Injectable()
export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly uow: UnitOfWork) {}

  async findById(txId: string) {
    if (!isUuid(txId)) return null;
    const row = await this.uow.client.transaction.findUnique({ where: { id: txId } });
    return row ? toTransaction(row) : null;
  }

  async findTrashed(trashId: string) {
    if (!isUuid(trashId)) return null;
    const row = await this.uow.client.transactionTrash.findUnique({ where: { id: trashId } });
    return row ? toTrashed(row) : null;
  }

  async loadContext(refs: LedgerContextRefs): Promise<DatabaseShape> {
    const client = this.uow.client;
    const memberIds = ids(refs.memberIds);
    const [types, members, accounts, guardians, projects, closings] = await Promise.all([
      client.movementType.findMany({
        where: refs.movementTypeIds ? { id: { in: ids(refs.movementTypeIds) } } : undefined,
      }),
      memberIds.length ? client.member.findMany({ where: { id: { in: memberIds } } }) : [],
      refs.memberAccountIds ? client.memberAccount.findMany({ where: { id: { in: ids(refs.memberAccountIds) } } }) : [],
      client.memberGuardian.findMany({
        where: {
          OR: [{ id: { in: ids(refs.memberGuardianIds) } }, { memberId: { in: ids(refs.guardiansOfMemberIds) } }],
        },
      }),
      refs.projectIds
        ? client.project.findMany({ where: { id: { in: ids(refs.projectIds) } }, select: { id: true } })
        : [],
      client.monthClosing.findMany({ orderBy: { yearMonth: 'asc' } }),
    ]);
    return {
      ...emptyFinance(),
      movementTypes: types.map(mapMovementType),
      members: members.map(mapMember),
      memberAccounts: accounts.map(mapAccount),
      memberGuardians: guardians.map(mapGuardian),
      projects: projects.map((row) => ({ id: row.id }) as FinancialProject),
      monthClosings: closings.map(toMonthClosing),
    };
  }

  add(tx: Transaction) {
    return this.uow.run(async () => {
      const context = await this.historyContext([tx]);
      context.transactions = [tx];
      assertClosedMonthsUntouched(new Map(), context);
      await this.uow.client.transaction.create({ data: toTransactionRow(tx) });
      await recordHistory(this.uow.client, diffTransactions(new Map(), context));
    });
  }

  save(tx: Transaction) {
    return this.uow.run(async () => {
      const before = await this.findById(tx.id);
      if (!before) throw new Error(`Lançamento ${tx.id} não existe para ser alterado`);
      const context = await this.historyContext([before, tx]);
      context.transactions = [tx];
      const previous = new Map([[before.id, before]]);
      assertClosedMonthsUntouched(previous, context);
      const { id: _id, ...data } = toTransactionRow(tx);
      await this.uow.client.transaction.update({ where: { id: tx.id }, data });
      await recordHistory(this.uow.client, diffTransactions(previous, context));
    });
  }

  moveToTrash(tx: Transaction, userId: string, now = new Date()) {
    return this.uow.run(async () => {
      const entry: TrashedTransaction = { id: id(), transaction: tx, deletedAt: now.toISOString(), deletedBy: userId };
      const context = await this.historyContext([tx]);
      context.trash = [entry];
      const previous = new Map([[tx.id, tx]]);
      assertClosedMonthsUntouched(previous, context);
      await this.uow.client.transaction.delete({ where: { id: tx.id } });
      await this.uow.client.transactionTrash.create({ data: toTrashRow(entry) });
      await recordHistory(this.uow.client, diffTransactions(previous, context));
      return entry;
    });
  }

  restoreFromTrash(entry: TrashedTransaction, tx: Transaction) {
    return this.uow.run(async () => {
      const context = await this.historyContext([tx]);
      context.transactions = [tx];
      assertClosedMonthsUntouched(new Map(), context);
      await this.uow.client.transaction.create({ data: toTransactionRow(tx) });
      await this.uow.client.transactionTrash.delete({ where: { id: entry.id } });
      await recordHistory(this.uow.client, diffTransactions(new Map(), context, new Set([tx.id])));
    });
  }

  purgeTrash(now: Date, days: number) {
    return this.uow.run(async () => {
      const limit = new Date(now.getTime() - days * 86_400_000);
      const { count } = await this.uow.client.transactionTrash.deleteMany({ where: { deletedAt: { lte: limit } } });
      return count;
    });
  }

  /** Tipos e associados citados, para o histórico mostrar nomes; e os meses fechados. */
  private historyContext(txs: Transaction[]) {
    return this.loadContext({
      movementTypeIds: txs.map((tx) => tx.movementTypeId),
      memberIds: txs.map((tx) => tx.memberId),
    });
  }
}
