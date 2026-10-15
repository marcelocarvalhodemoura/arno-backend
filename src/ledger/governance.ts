import { id } from '../shared/id';
import type { DatabaseShape, MonthClosing, Transaction, TrashedTransaction } from '../shared/types';
import { roundMoney } from '../shared/types';
import { BusinessRuleViolation, NotFound } from '../shared/domain/errors';

export const TRASH_DAYS = 30;

const MONTH_NAMES = [
  '',
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function monthLabel(yearMonth: string): string {
  return `${MONTH_NAMES[Number(yearMonth.slice(5, 7))] ?? yearMonth}/${yearMonth.slice(0, 4)}`;
}

/* ───────────── Lixeira ───────────── */

/** Exclusão pela tesouraria: o lançamento vai para a lixeira em vez de sumir. */
export function trashTransaction(
  db: DatabaseShape,
  txId: string,
  userId: string,
  now = new Date(),
): TrashedTransaction | null {
  const tx = db.transactions.find((item) => item.id === txId);
  if (!tx) return null;
  db.transactions = db.transactions.filter((item) => item.id !== txId);
  const entry: TrashedTransaction = { id: id(), transaction: tx, deletedAt: now.toISOString(), deletedBy: userId };
  db.trash = [...(db.trash ?? []), entry];
  return entry;
}

export function restoreTransaction(db: DatabaseShape, trashId: string): Transaction {
  const entry = (db.trash ?? []).find((item) => item.id === trashId);
  if (!entry) throw new NotFound('Item não encontrado na lixeira');
  if (db.transactions.some((item) => item.id === entry.transaction.id)) {
    throw new BusinessRuleViolation('Este lançamento já está no caixa');
  }
  if (!db.movementTypes.some((item) => item.id === entry.transaction.movementTypeId)) {
    throw new BusinessRuleViolation('O tipo deste lançamento foi removido; recrie o tipo antes de restaurar');
  }
  const tx = { ...entry.transaction };
  if (tx.memberId && !db.members.some((item) => item.id === tx.memberId)) delete tx.memberId;
  if (tx.memberAccountId && !db.memberAccounts.some((item) => item.id === tx.memberAccountId))
    delete tx.memberAccountId;
  if (tx.memberGuardianId && !db.memberGuardians.some((item) => item.id === tx.memberGuardianId)) {
    delete tx.memberGuardianId;
  }
  if (tx.projectId && !db.projects.some((item) => item.id === tx.projectId)) delete tx.projectId;
  db.transactions.push(tx);
  db.trash = (db.trash ?? []).filter((item) => item.id !== trashId);
  return tx;
}

/** Remove da lixeira o que passou do prazo (ou tudo, ao esvaziar). Devolve o que saiu. */
export function purgeTrash(db: DatabaseShape, now = new Date(), days = TRASH_DAYS): TrashedTransaction[] {
  const limit = now.getTime() - days * 86_400_000;
  const keep: TrashedTransaction[] = [];
  const purged: TrashedTransaction[] = [];
  for (const entry of db.trash ?? []) {
    if (new Date(entry.deletedAt).getTime() <= limit) purged.push(entry);
    else keep.push(entry);
  }
  db.trash = keep;
  return purged;
}

/* ───────────── Fechamento do mês ───────────── */

function isSettled(tx: Transaction) {
  return tx.paymentStatus !== 'pending';
}

/** Mês (AAAA-MM) em que o lançamento pesa no caixa: pagos contam pelo vencimento, como no fluxo. */
function lockedMonthOf(tx: Transaction | undefined, closed: Set<string>): string | null {
  if (!tx || !isSettled(tx)) return null;
  const month = tx.date.slice(0, 7);
  return closed.has(month) ? month : null;
}

export function closedMonthSet(db: Pick<DatabaseShape, 'monthClosings'>): Set<string> {
  return new Set((db.monthClosings ?? []).map((item) => item.yearMonth));
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Impede alterar lançamentos pagos de um mês fechado (editar, excluir ou criar outro pago nele).
 * Dar baixa em cobrança pendente do mês continua permitido: pagamento atrasado precisa ser registrado.
 */
export function assertClosedMonthsUntouched(before: Map<string, Transaction>, db: DatabaseShape) {
  const closed = closedMonthSet(db);
  if (!closed.size) return;
  const after = new Map(db.transactions.map((tx) => [tx.id, tx]));
  for (const txId of new Set([...before.keys(), ...after.keys()])) {
    const prev = before.get(txId);
    const next = after.get(txId);
    const prevLocked = lockedMonthOf(prev, closed);
    const nextLocked = lockedMonthOf(next, closed);
    if (!prevLocked && !nextLocked) continue;
    if (prev && next && stableStringify(prev) === stableStringify(next)) continue;
    const lateSettlement = !prevLocked && prev?.paymentStatus === 'pending';
    if (!prevLocked && lateSettlement) continue;
    const month = (prevLocked ?? nextLocked)!;
    throw new BusinessRuleViolation(
      `${monthLabel(month)} está fechado: lançamentos pagos desse mês não podem ser alterados. Peça ao admin para reabrir o mês.`,
    );
  }
}

export function monthTotals(db: DatabaseShape, yearMonth: string) {
  let income = 0;
  let expense = 0;
  let net = 0;
  const lastDay = `${yearMonth}-31`;
  for (const tx of db.transactions) {
    if (!isSettled(tx)) continue;
    const signed = tx.type === 'income' ? tx.amount : -tx.amount;
    if (tx.date <= lastDay) net += signed;
    if (!tx.date.startsWith(yearMonth)) continue;
    if (tx.type === 'income') income += tx.amount;
    else expense += tx.amount;
  }
  return {
    income: roundMoney(income),
    expense: roundMoney(expense),
    balance: roundMoney(db.settings.openingBalance + net),
  };
}

export function closeMonth(db: DatabaseShape, yearMonth: string, userId: string, now = new Date()): MonthClosing {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new BusinessRuleViolation('Mês inválido (use AAAA-MM)');
  if (closedMonthSet(db).has(yearMonth)) throw new BusinessRuleViolation(`${monthLabel(yearMonth)} já está fechado`);
  const today = now.toISOString().slice(0, 7);
  if (yearMonth >= today) throw new BusinessRuleViolation('Só é possível fechar meses que já terminaram');
  const closing: MonthClosing = {
    yearMonth,
    closedAt: now.toISOString(),
    closedBy: userId,
    ...monthTotals(db, yearMonth),
  };
  db.monthClosings = [...(db.monthClosings ?? []), closing].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  return closing;
}

export function reopenMonth(db: DatabaseShape, yearMonth: string): boolean {
  const before = db.monthClosings?.length ?? 0;
  db.monthClosings = (db.monthClosings ?? []).filter((item) => item.yearMonth !== yearMonth);
  return db.monthClosings.length < before;
}

/* ───────────── Histórico de alterações ───────────── */

export type HistoryChange = { field: string; label: string; from: string | null; to: string | null };
export type HistoryEntry = {
  transactionId: string;
  kind: 'created' | 'updated' | 'deleted' | 'restored';
  byId: string | null;
  changes: HistoryChange[];
};

const TRACKED: { field: keyof Transaction; label: string }[] = [
  { field: 'amount', label: 'Valor' },
  { field: 'date', label: 'Vencimento' },
  { field: 'paymentStatus', label: 'Situação' },
  { field: 'paidAt', label: 'Data de pagamento' },
  { field: 'movementTypeId', label: 'Tipo' },
  { field: 'memberId', label: 'Associado' },
  { field: 'description', label: 'Descrição' },
  { field: 'type', label: 'Entrada/saída' },
  { field: 'method', label: 'Meio' },
  { field: 'branch', label: 'Ramo' },
  { field: 'splitGroupId', label: 'Rateio' },
  { field: 'notaFileName', label: 'Nota' },
];

function readable(db: DatabaseShape, field: keyof Transaction, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (field === 'movementTypeId') return db.movementTypes.find((item) => item.id === value)?.name ?? String(value);
  if (field === 'memberId') return db.members.find((item) => item.id === value)?.name ?? 'associado removido';
  if (field === 'paymentStatus') return value === 'pending' ? 'pendente' : 'pago';
  if (field === 'type') return value === 'income' ? 'entrada' : 'saída';
  if (field === 'splitGroupId') return 'rateado';
  if (field === 'amount') return Number(value).toFixed(2);
  return String(value);
}

/** Compara o antes e o depois de uma gravação e devolve uma linha por lançamento afetado. */
export function diffTransactions(
  before: Map<string, Transaction>,
  db: DatabaseShape,
  restoredIds: Set<string> = new Set(),
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const after = new Map(db.transactions.map((tx) => [tx.id, tx]));
  const trashedBy = new Map((db.trash ?? []).map((item) => [item.transaction.id, item.deletedBy ?? null]));

  for (const [txId, next] of after) {
    const prev = before.get(txId);
    if (!prev) {
      entries.push({
        transactionId: txId,
        kind: restoredIds.has(txId) ? 'restored' : 'created',
        byId: next.updatedBy ?? next.createdBy ?? null,
        changes: [],
      });
      continue;
    }
    const changes: HistoryChange[] = [];
    for (const { field, label } of TRACKED) {
      const from = readable(db, field, prev[field]);
      const to = readable(db, field, next[field]);
      if (from !== to) changes.push({ field, label, from, to });
    }
    if (!changes.length) continue;
    const stamped = next.updatedAt && next.updatedAt !== prev.updatedAt;
    entries.push({
      transactionId: txId,
      kind: 'updated',
      byId: stamped ? (next.updatedBy ?? null) : null,
      changes,
    });
  }

  for (const [txId] of before) {
    if (after.has(txId)) continue;
    if (!trashedBy.has(txId)) continue;
    entries.push({ transactionId: txId, kind: 'deleted', byId: trashedBy.get(txId) ?? null, changes: [] });
  }
  return entries;
}
