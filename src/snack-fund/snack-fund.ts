import type { DatabaseShape, Member, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';
import {
  DEFAULT_FEE_SCHEDULE,
  type FeeSchedule,
  mensalidadeShares,
  monthFromDate,
  periodFor,
  scheduleOf,
} from '../mensalidades/fee-table';
import { isMensalidadeName } from '../statement/statement';
import { fold } from '../shared/csv';

export type SnackFundIncomeLine = {
  transactionId: string;
  memberId: string;
  memberName: string;
  branch: string;
  dueDate: string;
  paidAt: string;
  amountPaid: number;
  snackShare: number;
  competenceMonth: number;
};

export type SnackFundExpenseLine = {
  transactionId: string;
  date: string;
  description: string;
  movementTypeName: string;
  amount: number;
  branch: string;
};

export type SnackFundPreview = {
  year: number;
  month: number;
  snackShareUnit: number;
  incomeLines: SnackFundIncomeLine[];
  expenseLines: SnackFundExpenseLine[];
  collected: number;
  spent: number;
  available: number;
  incomeCount: number;
  expenseCount: number;
};

export type SnackFundMonthSummary = {
  month: number;
  incomeCount: number;
  collected: number;
  spent: number;
  available: number;
};

export type SnackFundYearSummary = {
  year: number;
  snackShareUnit: number;
  months: SnackFundMonthSummary[];
  collected: number;
  spent: number;
  available: number;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function isMensalidadeTx(db: DatabaseShape, tx: Transaction) {
  if (tx.type !== 'income') return false;
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return Boolean(movement && isMensalidadeName(movement.name));
}

/** Nome do tipo de movimentação conta como gasto da taxa de lanche. */
export function isSnackExpenseMovementName(name: string): boolean {
  const key = fold(name);
  return key.includes('lanche') || key.includes('alimenta');
}

/** Parcela de lanche da mensalidade, conforme a composição do mês de competência. */
export function snackShareOf(
  profile: Pick<Member, 'branch' | 'role' | 'clubeLtc' | 'feeOverride' | 'monthlyFee'>,
  dueDate: string,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): number {
  return mensalidadeShares(profile, dueDate, { late: false, clubFeeIncluded: false }, schedule).snack;
}

function snackUnit(db: DatabaseShape, yearMonth: string): number {
  return periodFor(scheduleOf(db), yearMonth).regular.snack;
}

function eventDate(tx: Transaction): string {
  if (tx.paidAt) return tx.paidAt.slice(0, 10);
  return tx.date.slice(0, 10);
}

function collectIncomeLines(db: DatabaseShape, year: number, month: number): SnackFundIncomeLine[] {
  const prefix = `${year}-${pad2(month)}`;
  const lines: SnackFundIncomeLine[] = [];
  for (const tx of db.transactions) {
    if (!isMensalidadeTx(db, tx)) continue;
    if (tx.paymentStatus !== 'paid') continue;
    if (!tx.paidAt) continue;
    if (!tx.paidAt.startsWith(prefix)) continue;
    if (!tx.memberId) continue;
    const member = db.members.find((item) => item.id === tx.memberId);
    if (!member) continue;
    const snackShare = snackShareOf(member, tx.date, scheduleOf(db));
    if (snackShare <= 0) continue;
    lines.push({
      transactionId: tx.id,
      memberId: member.id,
      memberName: member.name,
      branch: member.branch,
      dueDate: tx.date.slice(0, 10),
      paidAt: tx.paidAt.slice(0, 10),
      amountPaid: tx.amount,
      snackShare,
      competenceMonth: monthFromDate(tx.date),
    });
  }
  lines.sort((a, b) => {
    const byPaid = a.paidAt.localeCompare(b.paidAt);
    if (byPaid) return byPaid;
    return a.memberName.localeCompare(b.memberName, 'pt-BR');
  });
  return lines;
}

function collectExpenseLines(db: DatabaseShape, year: number, month: number): SnackFundExpenseLine[] {
  const prefix = `${year}-${pad2(month)}`;
  const lines: SnackFundExpenseLine[] = [];
  for (const tx of db.transactions) {
    if (tx.type !== 'expense') continue;
    if (tx.paymentStatus === 'pending') continue;
    const when = eventDate(tx);
    if (!when.startsWith(prefix)) continue;
    const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
    if (!movement || !isSnackExpenseMovementName(movement.name)) continue;
    lines.push({
      transactionId: tx.id,
      date: when,
      description: tx.description,
      movementTypeName: movement.name,
      amount: tx.amount,
      branch: tx.branch,
    });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  return lines;
}

export function buildSnackFundPreview(db: DatabaseShape, year: number, month: number): SnackFundPreview {
  const incomeLines = collectIncomeLines(db, year, month);
  const expenseLines = collectExpenseLines(db, year, month);
  const collected = roundMoney(incomeLines.reduce((sum, line) => sum + line.snackShare, 0));
  const spent = roundMoney(expenseLines.reduce((sum, line) => sum + line.amount, 0));
  return {
    year,
    month,
    snackShareUnit: snackUnit(db, `${year}-${pad2(month)}`),
    incomeLines,
    expenseLines,
    collected,
    spent,
    available: roundMoney(collected - spent),
    incomeCount: incomeLines.length,
    expenseCount: expenseLines.length,
  };
}

export function buildSnackFundYearSummary(db: DatabaseShape, year: number): SnackFundYearSummary {
  const months: SnackFundMonthSummary[] = [];
  let collected = 0;
  let spent = 0;
  for (let month = 1; month <= 12; month += 1) {
    const preview = buildSnackFundPreview(db, year, month);
    if (!preview.incomeCount && !preview.expenseCount) continue;
    months.push({
      month,
      incomeCount: preview.incomeCount,
      collected: preview.collected,
      spent: preview.spent,
      available: preview.available,
    });
    collected = roundMoney(collected + preview.collected);
    spent = roundMoney(spent + preview.spent);
  }
  return {
    year,
    snackShareUnit: snackUnit(db, `${year}-11`),
    months,
    collected,
    spent,
    available: roundMoney(collected - spent),
  };
}
