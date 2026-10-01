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
import { siblingIdsOf } from '../members/members';
import { isMensalidadeName, isUnidentifiedName } from '../statement/statement';
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
import {
  embedMetaForCell,
  registerArrearsInstallmentPaid,
  stampMensalidadeEmbedLink,
  syncMensalidadeArrearsEmbed,
  yearMonthKey,
} from '../arrears/arrears';
import { stampPaidAt } from '../ledger/transactions';
import { splitTransaction } from '../ledger/split';

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

function syncPendingMensalidadeEmbedLink(
  db: DatabaseShape,
  tx: Transaction,
  _member: Member,
  _dueDate: string,
  userId = 'system',
  today = todayISO(),
) {
  syncMensalidadeArrearsEmbed(db, tx.id, userId, today, { recalculateBase: true });
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
  const drop = new Set<string>();
  for (const tx of db.transactions) {
    if (tx.memberId !== memberId) continue;
    if (tx.paymentStatus === 'paid') continue;
    if (!isMensalidadeTx(db, tx)) continue;
    if (tx.date < cutoff) continue;
    drop.add(tx.id);
    if (tx.splitGroupId) {
      for (const peer of db.transactions) {
        if (peer.splitGroupId === tx.splitGroupId) drop.add(peer.id);
      }
    }
  }
  const before = db.transactions.length;
  db.transactions = db.transactions.filter((tx) => !drop.has(tx.id));
  return before - db.transactions.length;
}

export function cancelUnpaidMensalidades(db: DatabaseShape, memberId: string): number {
  const drop = new Set<string>();
  for (const tx of db.transactions) {
    if (tx.memberId !== memberId) continue;
    if (tx.paymentStatus === 'paid') continue;
    if (!isMensalidadeTx(db, tx)) continue;
    drop.add(tx.id);
    if (tx.splitGroupId) {
      for (const peer of db.transactions) {
        if (peer.splitGroupId === tx.splitGroupId) drop.add(peer.id);
      }
    }
  }
  const before = db.transactions.length;
  db.transactions = db.transactions.filter((tx) => !drop.has(tx.id));
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
  const actor = userId ?? 'system';
  for (const tx of [...db.transactions]) {
    if (tx.paymentStatus === 'paid') continue;
    if (!isMensalidadeTx(db, tx)) continue;
    const year = Number(tx.date.slice(0, 4));
    const month = Number(tx.date.slice(5, 7));
    if (!year || !month) continue;
    const nextDate = dueDateForMonth(year, month, dueDay);
    const member = tx.memberId ? db.members.find((item) => item.id === tx.memberId) : undefined;
    const included = member ? effectiveClubFeeIncluded(member, tx.clubFeeIncluded) : true;
    if (member && tx.clubFeeIncluded === undefined) tx.clubFeeIncluded = included;
    if (tx.date !== nextDate) {
      tx.date = nextDate;
      if (tx.splitGroupId) {
        for (const peer of db.transactions) {
          if (peer.splitGroupId === tx.splitGroupId) peer.date = nextDate;
        }
      }
      updated += 1;
    }
    if (member) {
      syncPendingMensalidadeEmbedLink(db, tx, member, nextDate, actor, today);
      updated += 1;
    }
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
      const baseAmount = roundMoney(expectedMensalidadeAmount(member, dueDate, today, clubFeeIncluded));
      const createdTx: Transaction = {
        id: id(),
        date: dueDate,
        type: 'income',
        nature: 'fixed',
        movementTypeId: movement.id,
        description: `Mensalidade ${MONTH_NAMES[month]} ${year} — ${member.name}`,
        amount: baseAmount,
        branch: member.branch,
        method: 'pix',
        paymentStatus: 'pending',
        memberId: member.id,
        clubFeeIncluded,
        ...createdAudit(userId),
      };
      db.transactions.push(createdTx);
      syncPendingMensalidadeEmbedLink(db, createdTx, member, dueDate, userId, today);
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
  Object.assign(tx, updatedAudit(userId));
  syncPendingMensalidadeEmbedLink(db, tx, member, tx.date.slice(0, 10), userId, today);
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
    if (tx.clubFeeIncluded === input.clubFeeIncluded) {
      // ainda assim pode precisar re-sincronizar rateio
    }
    tx.clubFeeIncluded = input.clubFeeIncluded;
    Object.assign(tx, updatedAudit(userId));
    syncPendingMensalidadeEmbedLink(db, tx, member, tx.date.slice(0, 10), userId, today);
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
  const base = mensalidadeAmountForTiming(member, dueDate, clubFeeIncluded, input.timing);
  const ym = yearMonthKey(Number(dueDate.slice(0, 4)), Number(dueDate.slice(5, 7)));
  const embed = embedMetaForCell(db, member.id, Number(dueDate.slice(0, 4)), Number(dueDate.slice(5, 7)), 'pending');
  const shouldNotify = input.notifyReceipt !== false;
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  const paidAt = input.paidAt ?? today;

  const peers = tx.splitGroupId ? db.transactions.filter((item) => item.splitGroupId === tx.splitGroupId) : [tx];
  const arrearsPart = peers.find((item) => item.arrearsId && item.arrearsYearMonth && item.id !== tx.id);

  tx.amount = base;
  tx.clubFeeIncluded = clubFeeIncluded;
  stampPaidAt(tx, movement?.name ?? 'Mensalidade', 'paid', paidAt, today);
  Object.assign(tx, updatedAudit(userId));

  if (arrearsPart && arrearsPart.paymentStatus !== 'paid') {
    const arrearsMovement = db.movementTypes.find((item) => item.id === arrearsPart.movementTypeId);
    stampPaidAt(arrearsPart, arrearsMovement?.name ?? 'Acordo', 'paid', paidAt, today);
    Object.assign(arrearsPart, updatedAudit(userId));
    if (arrearsPart.arrearsId && arrearsPart.arrearsYearMonth) {
      registerArrearsInstallmentPaid(db, arrearsPart.arrearsId, arrearsPart.arrearsYearMonth, userId, {
        source: 'mensalidade',
        transactionId: arrearsPart.id,
        method: arrearsPart.method,
        paidAt: arrearsPart.paidAt ?? paidAt,
      });
    }
  } else if (embed.arrearsPlanId && embed.extra > 0) {
    // Legado: mensalidade plana com parcela embutida (sem rateio).
    tx.amount = roundMoney(base + embed.extra);
    stampMensalidadeEmbedLink(tx, embed.arrearsPlanId);
    registerArrearsInstallmentPaid(db, embed.arrearsPlanId, ym, userId, {
      source: 'mensalidade',
      transactionId: tx.id,
      method: tx.method,
      paidAt: tx.paidAt ?? paidAt,
    });
  }

  return { tx, shouldNotify };
}

/** Baixa várias mensalidades (ex.: irmãos no mesmo mês) com o mesmo timing/data. */
export function settleMensalidades(
  db: DatabaseShape,
  input: {
    transactionIds: string[];
    timing: MensalidadeSettleTiming;
    paidAt?: string | null;
    notifyReceipt?: boolean;
  },
  userId: string,
  today = todayISO(),
): { items: { tx: Transaction; shouldNotify: boolean }[] } {
  const unique = [...new Set(input.transactionIds.map((item) => item.trim()).filter(Boolean))];
  if (!unique.length) throw new Error('Informe ao menos uma mensalidade');
  const items: { tx: Transaction; shouldNotify: boolean }[] = [];
  for (const transactionId of unique) {
    const settled = settleMensalidade(
      db,
      {
        transactionId,
        timing: input.timing,
        paidAt: input.paidAt,
        notifyReceipt: input.notifyReceipt,
      },
      userId,
      today,
    );
    if (!settled) throw new Error('Mensalidade não encontrada');
    items.push(settled);
  }
  return { items };
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
        const status = cellStatus(tx?.paymentStatus, dueDate, today);
        const embed = embedMetaForCell(db, member.id, year, month, status);
        const baseOpen = expectedMensalidadeAmount(member, dueDate, today, clubFeeIncluded);
        return {
          month,
          dueDate,
          status,
          transactionId: tx?.id,
          amount: tx?.amount ?? roundMoney(baseOpen + embed.extra),
          onTimeAmount: roundMoney(onTimeAmount + embed.extra),
          lateAmount: roundMoney(lateAmount + embed.extra),
          clubFeeIncluded,
          arrearsInstallment: embed.arrearsInstallment,
          arrearsPlanId: embed.arrearsPlanId,
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
        siblingIds: siblingIdsOf(db, member.id),
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

export type AllocateMensalidadeMonth = { year: number; month: number };

function parseAllocateMonths(yearMonths: string[]): AllocateMensalidadeMonth[] {
  const parsed: AllocateMensalidadeMonth[] = [];
  const seen = new Set<string>();
  for (const raw of yearMonths) {
    const match = /^(\d{4})-(\d{2})$/.exec(raw.trim());
    if (!match) throw new Error(`Competência inválida: ${raw}`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!MENSALIDADE_MONTHS.includes(month)) {
      throw new Error(`Mensalidade só cobre março a novembro (${raw})`);
    }
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (seen.has(key)) throw new Error(`Competência repetida: ${key}`);
    seen.add(key);
    parsed.push({ year, month });
  }
  parsed.sort((a, b) => a.year - b.year || a.month - b.month);
  return parsed;
}

/** Prévia dos valores por mês (pontual ou atraso) para bater com o Pix. */
export function previewAllocateMensalidades(
  db: DatabaseShape,
  input: {
    memberId: string;
    timing: MensalidadeSettleTiming;
    yearMonths: string[];
  },
) {
  const member = db.members.find((item) => item.id === input.memberId);
  if (!member || !paysMensalidade(member)) throw new Error('Associado inválido para mensalidade');
  const months = parseAllocateMonths(input.yearMonths);
  if (months.length < 2) throw new Error('Selecione ao menos dois meses para o rateio');
  const dueDay = dueDayOf(db);
  const items = months.map(({ year, month }) => {
    const dueDate = dueDateForMonth(year, month, dueDay);
    const existing = mensalidadeForMonth(db, member.id, year, month);
    if (existing?.paymentStatus === 'paid') {
      throw new Error(`Mensalidade de ${MONTH_NAMES[month]} ${year} já está paga`);
    }
    const clubFeeIncluded = effectiveClubFeeIncluded(member, existing?.clubFeeIncluded);
    const base = mensalidadeAmountForTiming(member, dueDate, clubFeeIncluded, input.timing);
    const embed = embedMetaForCell(db, member.id, year, month, 'pending');
    const amount = roundMoney(base + embed.extra);
    return {
      yearMonth: yearMonthKey(year, month),
      year,
      month,
      dueDate,
      amount,
      onTimeAmount: roundMoney(mensalidadeAmountForTiming(member, dueDate, clubFeeIncluded, 'on_time') + embed.extra),
      lateAmount: roundMoney(mensalidadeAmountForTiming(member, dueDate, clubFeeIncluded, 'late') + embed.extra),
      clubFeeIncluded,
      arrearsInstallment: embed.arrearsInstallment,
      arrearsPlanId: embed.arrearsPlanId,
      pendingTransactionId: existing?.id,
    };
  });
  return {
    memberId: member.id,
    memberName: member.name,
    timing: input.timing,
    items,
    total: roundMoney(items.reduce((sum, item) => sum + item.amount, 0)),
  };
}

/**
 * Rateia um crédito já pago (extrato) em mensalidades de competências escolhidas.
 * O usuário define pontual vs atraso; a data do Pix fica em paidAt.
 */
export function allocateBankCreditToMensalidades(
  db: DatabaseShape,
  input: {
    transactionId: string;
    memberId: string;
    timing: MensalidadeSettleTiming;
    yearMonths: string[];
    paidAt?: string | null;
    notifyReceipt?: boolean;
  },
  userId: string,
): { items: Transaction[]; amount: number; shouldNotify: boolean } {
  const credit = db.transactions.find((item) => item.id === input.transactionId);
  if (!credit) throw new Error('Lançamento não encontrado');
  if (credit.type !== 'income') throw new Error('Só entradas podem baixar mensalidades');
  if ((credit.paymentStatus ?? 'paid') !== 'paid') {
    throw new Error('O lançamento do extrato precisa estar pago');
  }
  if (credit.splitGroupId) {
    throw new Error('Este lançamento já foi rateado; exclua o rateio antes de baixar mensalidades');
  }
  const creditType = db.movementTypes.find((item) => item.id === credit.movementTypeId);
  if (creditType && !isMensalidadeName(creditType.name) && !isUnidentifiedName(creditType.name)) {
    throw new Error('Só créditos de mensalidade (ou ainda não identificados) podem ser rateados em mensalidades');
  }

  const preview = previewAllocateMensalidades(db, {
    memberId: input.memberId,
    timing: input.timing,
    yearMonths: input.yearMonths,
  });
  const creditAmount = roundMoney(credit.amount);
  if (preview.total !== creditAmount) {
    throw new Error(
      `A soma das mensalidades (${preview.total.toFixed(2)}) precisa ser igual ao Pix (${creditAmount.toFixed(2)})`,
    );
  }

  const member = db.members.find((item) => item.id === input.memberId)!;
  const movement = ensureMensalidadeType(db, userId);
  const paidAt = (input.paidAt?.trim() || credit.paidAt || credit.date).slice(0, 10);

  // Remove pendências (e rateio embutido de acordo) que este Pix substitui.
  const drop = new Set<string>();
  for (const item of preview.items) {
    if (!item.pendingTransactionId) continue;
    const pending = db.transactions.find((tx) => tx.id === item.pendingTransactionId);
    if (!pending || pending.id === credit.id) continue;
    if (pending.splitGroupId) {
      for (const peer of db.transactions) {
        if (peer.splitGroupId === pending.splitGroupId) drop.add(peer.id);
      }
    } else {
      drop.add(pending.id);
    }
  }
  if (drop.size) {
    db.transactions = db.transactions.filter((tx) => !drop.has(tx.id));
  }

  const parts = preview.items.map((item) => ({
    amount: item.amount,
    movementTypeId: movement.id,
    description: `Mensalidade ${MONTH_NAMES[item.month]} ${item.year} — ${member.name}`,
    memberId: member.id,
    date: item.dueDate,
    paidAt,
    paymentStatus: 'paid' as const,
    clubFeeIncluded: item.clubFeeIncluded,
    branch: member.branch,
    nature: 'fixed' as const,
  }));

  const created = splitTransaction(db, credit.id, parts, userId);

  for (const [index, tx] of created.entries()) {
    const meta = preview.items[index];
    if (!meta) continue;
    stampPaidAt(tx, movement.name, 'paid', paidAt);
    tx.method = credit.method ?? tx.method ?? 'pix';
    if (meta.arrearsPlanId && meta.arrearsInstallment) {
      stampMensalidadeEmbedLink(tx, meta.arrearsPlanId);
      registerArrearsInstallmentPaid(db, meta.arrearsPlanId, meta.yearMonth, userId, {
        source: 'mensalidade',
        transactionId: tx.id,
        method: tx.method,
        paidAt,
      });
    }
    Object.assign(tx, updatedAudit(userId));
  }

  return {
    items: created,
    amount: preview.total,
    shouldNotify: input.notifyReceipt !== false,
  };
}
