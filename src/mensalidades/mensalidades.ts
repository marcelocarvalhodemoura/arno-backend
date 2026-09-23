import { createdAudit, updatedAudit } from '../shared/audit';
import {
  applyOfficialFee,
  defaultClubFeeIncluded,
  effectiveClubFeeIncluded,
  ensureOfficialMensalidadeFees,
  expectedMensalidadeAmount,
  lateMonthlyFee,
  onTimeMonthlyFee,
  paysMensalidade,
  resolveFeeOverride,
} from './fee-table';
import { id } from '../shared/id';
import { isMensalidadeName } from '../statement/statement';
import type {
  DatabaseShape,
  MensalidadeCell,
  MensalidadeCellStatus,
  MensalidadeReport,
  MensalidadeRow,
  Member,
  Transaction,
} from '../shared/types';
import { resolveMensalidadeDueDay, roundMoney } from '../shared/types';
import { stampPaidAt } from '../ledger/transactions';

export const MENSALIDADE_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11];

export type MensalidadeSettleTiming = 'on_time' | 'late';

/** Dia seguinte (ISO YYYY-MM-DD) para forçar cálculo do valor com atraso. */
export function dayAfterISO(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

export function mensalidadeAmountForTiming(
  profile: Parameters<typeof expectedMensalidadeAmount>[0],
  dueDate: string,
  clubFeeIncluded: boolean,
  timing: MensalidadeSettleTiming,
): number {
  const today = timing === 'on_time' ? dueDate : dayAfterISO(dueDate);
  return roundMoney(expectedMensalidadeAmount(profile, dueDate, today, clubFeeIncluded));
}

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

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function todayISO(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function dueDayOf(db: Pick<DatabaseShape, 'settings'>): number {
  return resolveMensalidadeDueDay(db.settings.mensalidadeDueDay);
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function dueDateForMonth(year: number, month: number, dueDay?: number): string {
  const day = Math.min(resolveMensalidadeDueDay(dueDay), lastDayOfMonth(year, month));
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function nextMonthStart(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${pad2(month + 1)}-01`;
}

export function firstOwedMonth(year: number, joinedAt: string): number | null {
  const joinYear = Number(joinedAt.slice(0, 4));
  const joinMonth = Number(joinedAt.slice(5, 7));
  if (!joinYear || !joinMonth || joinYear > year) return null;
  if (joinYear < year) return MENSALIDADE_MONTHS[0];
  if (joinMonth > 12) return null;
  return Math.max(MENSALIDADE_MONTHS[0], joinMonth);
}

export function cellStatus(
  paymentStatus: string | undefined,
  dueDate: string,
  today: string,
): Exclude<MensalidadeCellStatus, 'none'> {
  if (paymentStatus === 'paid') return 'paid';
  return dueDate < today ? 'overdue' : 'pending';
}

function yearMonth(year: number, month: number) {
  return `${year}-${pad2(month)}`;
}

function isMensalidadeTx(db: DatabaseShape, tx: Transaction) {
  if (tx.type !== 'income') return false;
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return Boolean(movement && isMensalidadeName(movement.name));
}

export function mensalidadeForMonth(
  db: DatabaseShape,
  memberId: string,
  year: number,
  month: number,
): Transaction | undefined {
  const prefix = yearMonth(year, month);
  const matches = db.transactions.filter(
    (tx) => tx.memberId === memberId && tx.date.startsWith(prefix) && isMensalidadeTx(db, tx),
  );
  return matches.find((tx) => tx.paymentStatus === 'paid') ?? matches[0];
}

export function cancelSubsequentMensalidades(db: DatabaseShape, memberId: string, today = todayISO()): number {
  const cutoff = nextMonthStart(today);
  const before = db.transactions.length;
  db.transactions = db.transactions.filter((tx) => {
    if (tx.memberId !== memberId) return true;
    if (tx.paymentStatus === 'paid') return true;
    if (!isMensalidadeTx(db, tx)) return true;
    return tx.date < cutoff;
  });
  return before - db.transactions.length;
}

export function cancelUnpaidMensalidades(db: DatabaseShape, memberId: string): number {
  const before = db.transactions.length;
  db.transactions = db.transactions.filter((tx) => {
    if (tx.memberId !== memberId) return true;
    if (tx.paymentStatus === 'paid') return true;
    if (!isMensalidadeTx(db, tx)) return true;
    return false;
  });
  return before - db.transactions.length;
}

export function ensureMensalidadeType(db: DatabaseShape, userId: string) {
  const existing = db.movementTypes.find((item) => item.active && isMensalidadeName(item.name));
  if (existing) return existing;
  const created = {
    id: id(),
    name: 'Mensalidade',
    direction: 'income' as const,
    description: 'Mensalidade do associado no ano escoteiro',
    pixKey: '',
    branch: 'grupo' as const,
    active: true,
    ...createdAudit(userId),
  };
  db.movementTypes.push(created);
  return created;
}

export function refreshPendingMensalidadeSchedule(db: DatabaseShape, today = todayISO(), userId?: string) {
  for (const member of db.members) {
    if (!paysMensalidade(member)) cancelUnpaidMensalidades(db, member.id);
  }
  const dueDay = dueDayOf(db);
  let updated = 0;
  for (const tx of db.transactions) {
    if (tx.paymentStatus === 'paid') continue;
    if (!isMensalidadeTx(db, tx)) continue;
    const year = Number(tx.date.slice(0, 4));
    const month = Number(tx.date.slice(5, 7));
    if (!year || !month) continue;
    const nextDate = dueDateForMonth(year, month, dueDay);
    const member = tx.memberId ? db.members.find((item) => item.id === tx.memberId) : undefined;
    const included = member ? effectiveClubFeeIncluded(member, tx.clubFeeIncluded) : true;
    const nextAmount = member
      ? roundMoney(expectedMensalidadeAmount(member, nextDate, today, included))
      : roundMoney(tx.amount);
    if (tx.date === nextDate && roundMoney(tx.amount) === nextAmount) {
      if (member && tx.clubFeeIncluded === undefined) {
        tx.clubFeeIncluded = included;
        if (userId) Object.assign(tx, updatedAudit(userId));
        updated += 1;
      }
      continue;
    }
    tx.date = nextDate;
    tx.amount = nextAmount;
    if (member && tx.clubFeeIncluded === undefined) tx.clubFeeIncluded = included;
    if (userId) Object.assign(tx, updatedAudit(userId));
    updated += 1;
  }
  return updated;
}

export function refreshPendingMensalidadeAmounts(db: DatabaseShape, today = todayISO(), userId?: string) {
  return refreshPendingMensalidadeSchedule(db, today, userId);
}

/** Remove mensalidades pendentes fora do calendário (ex.: dezembro legado). */
export function cancelOutOfSeasonMensalidades(db: DatabaseShape): number {
  const before = db.transactions.length;
  db.transactions = db.transactions.filter((tx) => {
    if (tx.paymentStatus === 'paid') return true;
    if (!isMensalidadeTx(db, tx)) return true;
    const month = Number(tx.date.slice(5, 7));
    return MENSALIDADE_MONTHS.includes(month);
  });
  return before - db.transactions.length;
}

export function syncMensalidades(db: DatabaseShape, year: number, userId: string, today = todayISO()): number {
  const dueDay = dueDayOf(db);
  ensureOfficialMensalidadeFees(db, userId);
  const movement = ensureMensalidadeType(db, userId);
  cancelOutOfSeasonMensalidades(db);
  let created = 0;
  for (const member of db.members) {
    applyOfficialFee(member);
    if (!paysMensalidade(member)) {
      cancelUnpaidMensalidades(db, member.id);
      continue;
    }
    if (member.status !== 'active') {
      cancelSubsequentMensalidades(db, member.id, today);
      continue;
    }
    if (!(member.monthlyFee > 0)) continue;
    const first = firstOwedMonth(year, member.joinedAt);
    if (!first) continue;
    for (const month of MENSALIDADE_MONTHS) {
      if (month < first) continue;
      if (mensalidadeForMonth(db, member.id, year, month)) continue;
      const dueDate = dueDateForMonth(year, month, dueDay);
      const clubFeeIncluded = defaultClubFeeIncluded(member);
      db.transactions.push({
        id: id(),
        date: dueDate,
        type: 'income',
        nature: 'fixed',
        movementTypeId: movement.id,
        description: `Mensalidade ${MONTH_NAMES[month]} ${year} — ${member.name}`,
        amount: roundMoney(expectedMensalidadeAmount(member, dueDate, today, clubFeeIncluded)),
        branch: member.branch,
        method: 'pix',
        paymentStatus: 'pending',
        memberId: member.id,
        clubFeeIncluded,
        ...createdAudit(userId),
      });
      created += 1;
    }
  }
  refreshPendingMensalidadeSchedule(db, today, userId);
  return created;
}

export function applyMensalidadeFee(
  db: DatabaseShape,
  _previousAmount: number,
  _nextAmount: number,
  userId: string,
  today = todayISO(),
) {
  let updated = 0;
  for (const member of db.members) {
    const next = onTimeMonthlyFee(member);
    if (roundMoney(member.monthlyFee) === next) continue;
    member.monthlyFee = next;
    Object.assign(member, updatedAudit(userId));
    updated += 1;
  }
  refreshPendingMensalidadeSchedule(db, today, userId);
  return updated;
}

export function assignOfficialFee(member: Member, userId?: string) {
  applyOfficialFee(member);
  if (userId) Object.assign(member, updatedAudit(userId));
  return member.monthlyFee;
}

/** Altera a parcela do clube em uma mensalidade pendente e recalcula o valor. */
export function setMensalidadeClubFee(
  db: DatabaseShape,
  transactionId: string,
  clubFeeIncluded: boolean,
  userId: string,
  today = todayISO(),
): Transaction | null {
  const tx = db.transactions.find((item) => item.id === transactionId);
  if (!tx || !isMensalidadeTx(db, tx)) return null;
  if (tx.paymentStatus === 'paid') throw new Error('Mensalidade já paga não pode alterar a taxa do clube');
  const member = tx.memberId ? db.members.find((item) => item.id === tx.memberId) : undefined;
  if (!member) throw new Error('Mensalidade sem associado');
  tx.clubFeeIncluded = clubFeeIncluded;
  tx.amount = roundMoney(expectedMensalidadeAmount(member, tx.date.slice(0, 10), today, clubFeeIncluded));
  Object.assign(tx, updatedAudit(userId));
  return tx;
}

/** Inclui ou remove a taxa do clube em todas as mensalidades pendentes do ano (opcionalmente de um mês). */
export function setMensalidadeClubFeeBulk(
  db: DatabaseShape,
  input: { year: number; month?: number; clubFeeIncluded: boolean },
  userId: string,
  today = todayISO(),
): number {
  let updated = 0;
  for (const tx of db.transactions) {
    if (tx.paymentStatus === 'paid') continue;
    if (!isMensalidadeTx(db, tx)) continue;
    const year = Number(tx.date.slice(0, 4));
    const month = Number(tx.date.slice(5, 7));
    if (year !== input.year) continue;
    if (input.month && month !== input.month) continue;
    const member = tx.memberId ? db.members.find((item) => item.id === tx.memberId) : undefined;
    if (!member || !paysMensalidade(member)) continue;
    const nextAmount = roundMoney(
      expectedMensalidadeAmount(member, tx.date.slice(0, 10), today, input.clubFeeIncluded),
    );
    if (tx.clubFeeIncluded === input.clubFeeIncluded && roundMoney(tx.amount) === nextAmount) continue;
    tx.clubFeeIncluded = input.clubFeeIncluded;
    tx.amount = nextAmount;
    Object.assign(tx, updatedAudit(userId));
    updated += 1;
  }
  return updated;
}

/**
 * Marca mensalidade como paga com valor pontual ou com atraso (lançamento retroativo).
 * paidAt opcional: data em que o pagamento ocorreu.
 */
export function settleMensalidade(
  db: DatabaseShape,
  input: {
    transactionId: string;
    timing: MensalidadeSettleTiming;
    paidAt?: string | null;
    notifyReceipt?: boolean;
  },
  userId: string,
  today = todayISO(),
): { tx: Transaction; shouldNotify: boolean } | null {
  const tx = db.transactions.find((item) => item.id === input.transactionId);
  if (!tx || !isMensalidadeTx(db, tx)) return null;
  if (tx.paymentStatus === 'paid') throw new Error('Mensalidade já está paga');
  const member = tx.memberId ? db.members.find((item) => item.id === tx.memberId) : undefined;
  if (!member) throw new Error('Mensalidade sem associado');
  const dueDate = tx.date.slice(0, 10);
  const clubFeeIncluded = effectiveClubFeeIncluded(member, tx.clubFeeIncluded);
  const amount = mensalidadeAmountForTiming(member, dueDate, clubFeeIncluded, input.timing);
  const shouldNotify = input.notifyReceipt !== false;
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  tx.amount = amount;
  tx.clubFeeIncluded = clubFeeIncluded;
  stampPaidAt(tx, movement?.name ?? 'Mensalidade', 'paid', input.paidAt ?? today, today);
  Object.assign(tx, updatedAudit(userId));
  return { tx, shouldNotify };
}

export function buildMensalidadeReport(db: DatabaseShape, year: number, today = todayISO()): MensalidadeReport {
  const dueDay = dueDayOf(db);
  const rows: MensalidadeRow[] = db.members
    .filter((member) => onTimeMonthlyFee(member) > 0)
    .map((member) => {
      const onTime = onTimeMonthlyFee(member);
      const late = lateMonthlyFee(member);
      const first = firstOwedMonth(year, member.joinedAt);
      const cells: MensalidadeCell[] = MENSALIDADE_MONTHS.map((month) => {
        if (!first || month < first) {
          return {
            month,
            dueDate: null,
            status: 'none',
            amount: onTime,
            onTimeAmount: onTime,
            lateAmount: late,
            clubFeeIncluded: defaultClubFeeIncluded(member),
          };
        }
        const dueDate = dueDateForMonth(year, month, dueDay);
        const tx = mensalidadeForMonth(db, member.id, year, month);
        if (!tx && member.status !== 'active') {
          return {
            month,
            dueDate: null,
            status: 'none',
            amount: onTime,
            onTimeAmount: onTime,
            lateAmount: late,
            clubFeeIncluded: defaultClubFeeIncluded(member),
          };
        }
        const clubFeeIncluded = effectiveClubFeeIncluded(member, tx?.clubFeeIncluded);
        const onTimeAmount = mensalidadeAmountForTiming(member, dueDate, clubFeeIncluded, 'on_time');
        const lateAmount = mensalidadeAmountForTiming(member, dueDate, clubFeeIncluded, 'late');
        return {
          month,
          dueDate,
          status: cellStatus(tx?.paymentStatus, dueDate, today),
          transactionId: tx?.id,
          amount: tx?.amount ?? expectedMensalidadeAmount(member, dueDate, today, clubFeeIncluded),
          onTimeAmount,
          lateAmount,
          clubFeeIncluded,
        };
      });
      return {
        memberId: member.id,
        name: member.name,
        branch: member.branch,
        role: member.role,
        memberStatus: member.status,
        joinedAt: member.joinedAt,
        dueDay,
        monthlyFee: onTime,
        lateFee: late,
        clubeLtc: member.clubeLtc,
        feeOverride: resolveFeeOverride(member),
        chiefChild: Boolean(member.chiefChild),
        cells,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const summary = {
    paid: 0,
    pending: 0,
    overdue: 0,
    openAmount: 0,
    paidAmount: 0,
  };
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.status === 'paid') {
        summary.paid += 1;
        summary.paidAmount += cell.amount;
      } else if (cell.status === 'pending') {
        summary.pending += 1;
        summary.openAmount += cell.amount;
      } else if (cell.status === 'overdue') {
        summary.overdue += 1;
        summary.openAmount += cell.amount;
      }
    }
  }

  return {
    year,
    dueDay,
    months: [...MENSALIDADE_MONTHS],
    rows,
    summary: {
      ...summary,
      openAmount: roundMoney(summary.openAmount),
      paidAmount: roundMoney(summary.paidAmount),
    },
  };
}
