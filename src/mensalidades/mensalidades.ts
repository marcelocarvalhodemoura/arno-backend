import { createdAudit, updatedAudit } from '../shared/audit';
import {
  applyOfficialFee,
  ensureOfficialMensalidadeFees,
  expectedMonthlyFee,
  lateMonthlyFee,
  onTimeMonthlyFee,
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

export const MENSALIDADE_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

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
    const nextAmount = member ? roundMoney(expectedMonthlyFee(member, nextDate, today)) : roundMoney(tx.amount);
    if (tx.date === nextDate && roundMoney(tx.amount) === nextAmount) continue;
    tx.date = nextDate;
    tx.amount = nextAmount;
    if (userId) Object.assign(tx, updatedAudit(userId));
    updated += 1;
  }
  return updated;
}

export function refreshPendingMensalidadeAmounts(db: DatabaseShape, today = todayISO(), userId?: string) {
  return refreshPendingMensalidadeSchedule(db, today, userId);
}

export function syncMensalidades(db: DatabaseShape, year: number, userId: string, today = todayISO()): number {
  const dueDay = dueDayOf(db);
  ensureOfficialMensalidadeFees(db, userId);
  const movement = ensureMensalidadeType(db, userId);
  let created = 0;
  for (const member of db.members) {
    applyOfficialFee(member);
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
      db.transactions.push({
        id: id(),
        date: dueDate,
        type: 'income',
        nature: 'fixed',
        movementTypeId: movement.id,
        description: `Mensalidade ${MONTH_NAMES[month]} ${year} — ${member.name}`,
        amount: roundMoney(expectedMonthlyFee(member, dueDate, today)),
        branch: member.branch,
        method: 'pix',
        paymentStatus: 'pending',
        memberId: member.id,
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
          return { month, dueDate: null, status: 'none', amount: onTime };
        }
        const dueDate = dueDateForMonth(year, month, dueDay);
        const tx = mensalidadeForMonth(db, member.id, year, month);
        if (!tx && member.status !== 'active') {
          return { month, dueDate: null, status: 'none', amount: onTime };
        }
        return {
          month,
          dueDate,
          status: cellStatus(tx?.paymentStatus, dueDate, today),
          transactionId: tx?.id,
          amount: tx?.amount ?? expectedMonthlyFee(member, dueDate, today),
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
