import type { DatabaseShape } from '../shared/types';
import { BRANCH_LABELS, roundMoney } from '../shared/types';
import { isMensalidadeName, isUnidentifiedName } from '../statement/statement';
import { cashBalance } from '../reports/finance';
import { buildMensalidadeReport, isMensalidadeYearGenerated, listOpenMensalidades } from './mensalidades';
import { todayISO } from '../shared/dates';
import { NotFound } from '../shared/domain/errors';

function typeName(db: DatabaseShape, movementTypeId: string) {
  return db.movementTypes.find((item) => item.id === movementTypeId)?.name ?? '';
}

function previousMonth(today: string) {
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Pendências do dia, da mais urgente para a menos. Cada item leva à tela certa. */
export function nextSteps(
  db: DatabaseShape,
  extra: { duplicates: number; suggestions: number; lastSyncAt?: string; sicrediConfigured: boolean },
  today = todayISO(),
) {
  const overdue = db.transactions.filter(
    (tx) =>
      tx.paymentStatus === 'pending' &&
      tx.type === 'income' &&
      tx.date < today &&
      isMensalidadeName(typeName(db, tx.movementTypeId)),
  );
  const unidentified = db.transactions.filter(
    (tx) => tx.paymentStatus !== 'pending' && isUnidentifiedName(typeName(db, tx.movementTypeId)),
  );
  const lastMonth = previousMonth(today);
  const lastMonthHasData = db.transactions.some((tx) => tx.date.startsWith(lastMonth));
  const lastMonthClosed = (db.monthClosings ?? []).some((item) => item.yearMonth === lastMonth);
  const syncDays = extra.lastSyncAt
    ? Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(extra.lastSyncAt)) / 86_400_000)
    : null;
  const nextYear = Number(today.slice(0, 4)) + 1;
  return {
    overdue: { count: overdue.length, amount: roundMoney(overdue.reduce((sum, tx) => sum + tx.amount, 0)) },
    unidentified: { count: unidentified.length },
    suggestions: { count: extra.suggestions },
    duplicates: { count: extra.duplicates },
    sync: { configured: extra.sicrediConfigured, lastSyncAt: extra.lastSyncAt ?? null, days: syncDays },
    closing: { yearMonth: lastMonth, pending: lastMonthHasData && !lastMonthClosed },
    trash: { count: db.trash?.length ?? 0 },
    nextYear: { year: nextYear, generated: isMensalidadeYearGenerated(db, nextYear) },
  };
}

/** Tudo de um associado num lugar: em aberto, acordos, pagos no ano e últimos lançamentos. */
export function memberProfile(db: DatabaseShape, memberId: string, today = todayISO()) {
  const member = db.members.find((item) => item.id === memberId);
  if (!member) throw new NotFound('Associado não encontrado');
  const year = Number(today.slice(0, 4));
  const open = listOpenMensalidades(db, memberId, today);
  const mine = db.transactions.filter((tx) => tx.memberId === memberId);
  const paidThisYear = mine.filter(
    (tx) => tx.paymentStatus !== 'pending' && tx.type === 'income' && (tx.paidAt ?? tx.date).startsWith(`${year}-`),
  );
  const row = isMensalidadeYearGenerated(db, year)
    ? buildMensalidadeReport(db, year, today).rows.find((item) => item.memberId === memberId)
    : undefined;
  return {
    member: {
      id: member.id,
      name: member.name,
      branch: member.branch,
      branchLabel: BRANCH_LABELS[member.branch],
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt,
      email: member.email,
      phone: member.phone,
    },
    guardians: (db.memberGuardians ?? [])
      .filter((item) => item.memberId === memberId)
      .map((item) => ({ id: item.id, name: item.name, relationship: item.relationship, phone: item.phone })),
    openAmount: roundMoney(
      open.reduce((sum, item) => sum + (item.status === 'overdue' ? item.lateAmount : item.onTimeAmount), 0),
    ),
    open,
    paidThisYear: roundMoney(paidThisYear.reduce((sum, tx) => sum + tx.amount, 0)),
    arrears: (db.memberArrears ?? [])
      .filter((item) => item.memberId === memberId && item.status === 'active')
      .map((item) => ({
        id: item.id,
        balance: item.balance,
        installmentAmount: item.installmentAmount,
        paidCount: item.totalCount - item.remainingCount,
        totalCount: item.totalCount,
        chargeMode: item.chargeMode,
      })),
    grade: row ? { year, cells: row.cells.map((cell) => ({ month: cell.month, status: cell.status })) } : null,
    recent: [...mine]
      .sort((a, b) => (b.paidAt ?? b.date).localeCompare(a.paidAt ?? a.date))
      .slice(0, 8)
      .map((tx) => ({
        id: tx.id,
        date: tx.date,
        paidAt: tx.paidAt ?? null,
        description: tx.description,
        amount: tx.amount,
        type: tx.type,
        paymentStatus: tx.paymentStatus,
        movementTypeName: typeName(db, tx.movementTypeId),
      })),
  };
}

/** Prestação de contas do período: saldos, entradas e saídas por ramo e inadimplência de mensalidades. */
export function assemblyReport(db: DatabaseShape, from: string, to: string, today = todayISO()) {
  const settled = db.transactions.filter((tx) => tx.paymentStatus !== 'pending' && tx.date >= from && tx.date <= to);
  const before = new Date(`${from}T12:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  const income = roundMoney(settled.filter((tx) => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0));
  const expense = roundMoney(settled.filter((tx) => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0));
  const branches = Object.keys(BRANCH_LABELS) as (keyof typeof BRANCH_LABELS)[];
  const byBranch = branches
    .map((branch) => {
      const rows = settled.filter((tx) => tx.branch === branch);
      return {
        branch,
        label: BRANCH_LABELS[branch],
        income: roundMoney(rows.filter((tx) => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)),
        expense: roundMoney(rows.filter((tx) => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)),
      };
    })
    .filter((row) => row.income || row.expense);
  const typeTotals = new Map<string, { name: string; type: string; amount: number }>();
  for (const tx of settled) {
    const key = `${tx.type}:${tx.movementTypeId}`;
    const current = typeTotals.get(key) ?? { name: typeName(db, tx.movementTypeId), type: tx.type, amount: 0 };
    current.amount = roundMoney(current.amount + tx.amount);
    typeTotals.set(key, current);
  }
  const fees = db.transactions.filter(
    (tx) =>
      tx.type === 'income' &&
      tx.date >= from &&
      tx.date <= to &&
      tx.date < today &&
      isMensalidadeName(typeName(db, tx.movementTypeId)),
  );
  const feesOverdue = fees.filter((tx) => tx.paymentStatus === 'pending');
  const feesTotal = roundMoney(fees.reduce((s, tx) => s + tx.amount, 0));
  const overdueAmount = roundMoney(feesOverdue.reduce((s, tx) => s + tx.amount, 0));
  return {
    from,
    to,
    groupName: db.settings.groupName,
    openingBalance: cashBalance(db, before.toISOString().slice(0, 10)),
    closingBalance: cashBalance(db, to),
    income,
    expense,
    result: roundMoney(income - expense),
    byBranch,
    byType: [...typeTotals.values()].sort((a, b) => b.amount - a.amount),
    delinquency: {
      count: feesOverdue.length,
      members: new Set(feesOverdue.map((tx) => tx.memberId)).size,
      amount: overdueAmount,
      rate: feesTotal ? Math.round((overdueAmount / feesTotal) * 1000) / 10 : 0,
    },
  };
}

/** Mensalidades vencidas e não pagas no período, por associado (para cobrança e prestação de contas). */
export function delinquencyReport(db: DatabaseShape, from: string, to: string, today = todayISO()) {
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const fees = db.transactions.filter(
    (tx) =>
      tx.type === 'income' &&
      tx.date >= from &&
      tx.date <= to &&
      tx.date < today &&
      isMensalidadeName(typeName(db, tx.movementTypeId)),
  );
  const overdue = fees.filter((tx) => tx.paymentStatus === 'pending');
  const byMember = new Map<string, { months: string[]; amount: number; oldest: string }>();
  for (const tx of overdue) {
    const key = tx.memberId ?? 'sem-associado';
    const entry = byMember.get(key) ?? { months: [], amount: 0, oldest: tx.date };
    entry.months.push(`${MONTHS[Number(tx.date.slice(5, 7)) - 1]}/${tx.date.slice(2, 4)}`);
    entry.amount = roundMoney(entry.amount + tx.amount);
    if (tx.date < entry.oldest) entry.oldest = tx.date;
    byMember.set(key, entry);
  }
  const rows = [...byMember.entries()]
    .map(([memberId, entry]) => {
      const member = db.members.find((item) => item.id === memberId);
      const guardian = (db.memberGuardians ?? []).find((item) => item.memberId === memberId);
      const days = Math.floor(
        (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${entry.oldest}T12:00:00Z`)) / 86_400_000,
      );
      return {
        memberId,
        name: member?.name ?? 'Associado removido',
        branch: member?.branch ?? 'grupo',
        branchLabel: member ? BRANCH_LABELS[member.branch] : '—',
        guardian: guardian ? `${guardian.name} (${guardian.relationship.toLowerCase()})` : null,
        phone: guardian?.phone || member?.phone || null,
        months: entry.months,
        count: entry.months.length,
        amount: entry.amount,
        oldest: entry.oldest,
        daysLate: days,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'));
  const totalDue = roundMoney(fees.reduce((sum, tx) => sum + tx.amount, 0));
  const overdueAmount = roundMoney(overdue.reduce((sum, tx) => sum + tx.amount, 0));
  const byBranch = new Map<string, { label: string; members: number; amount: number }>();
  for (const row of rows) {
    const entry = byBranch.get(row.branch) ?? { label: row.branchLabel, members: 0, amount: 0 };
    entry.members += 1;
    entry.amount = roundMoney(entry.amount + row.amount);
    byBranch.set(row.branch, entry);
  }
  return {
    from,
    to,
    rows,
    byBranch: [...byBranch.values()].sort((a, b) => b.amount - a.amount),
    totals: {
      members: rows.length,
      count: overdue.length,
      amount: overdueAmount,
      due: totalDue,
      rate: totalDue ? Math.round((overdueAmount / totalDue) * 1000) / 10 : 0,
    },
  };
}
