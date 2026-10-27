import { isMensalidadeName } from '../statement/statement';
import {
  amountsNear,
  effectiveClubFeeIncluded,
  mensalidadeFormula,
  paysMensalidade,
  periodFor,
  scheduleOf,
  type FeeSchedule,
} from '../mensalidades/fee-table';
import type { DatabaseShape, Member, MensalidadeAllocation, MensalidadeFormula, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';

/**
 * Divisão congelada das mensalidades pagas.
 *
 * A divisão é calculada uma vez, no dia em que a mensalidade é quitada, com a composição e o cadastro daquele dia,
 * e fica gravada. Editar a composição ou o cadastro depois não muda o passado: só a Conferência mostra a diferença.
 * A divisão é refeita apenas quando o próprio lançamento muda (valor, vencimento, pagamento, associado, clube).
 */

export type AllocationParts = Pick<
  MensalidadeAllocation,
  'group' | 'branch' | 'snack' | 'club' | 'dilution' | 'lateFee' | 'arrears'
>;

export const ALLOCATION_PART_KEYS = ['group', 'branch', 'snack', 'club', 'dilution', 'lateFee', 'arrears'] as const;

function isMensalidadeTx(db: DatabaseShape, tx: Transaction) {
  if (tx.type !== 'income') return false;
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return Boolean(movement && isMensalidadeName(movement.name));
}

/** Mensalidade quitada de associado que paga mensalidade: é a que recebe divisão. */
function allocatable(db: DatabaseShape, tx: Transaction): Member | null {
  if (tx.paymentStatus === 'pending' || !tx.memberId) return null;
  if (!isMensalidadeTx(db, tx)) return null;
  const member = db.members.find((item) => item.id === tx.memberId);
  if (!member || !paysMensalidade(member)) return null;
  return member;
}

/** Dados do lançamento que entram no cálculo; mudou algum, a divisão é refeita. */
export function allocationBasis(tx: Transaction): string {
  return [
    roundMoney(tx.amount).toFixed(2),
    tx.date.slice(0, 10),
    tx.paidAt?.slice(0, 10) ?? '',
    tx.memberId ?? '',
    tx.clubFeeIncluded == null ? '' : String(tx.clubFeeIncluded),
    tx.arrearsId ?? '',
    tx.arrearsYearMonth ?? '',
  ].join('|');
}

/**
 * Parcela de dívida somada no próprio lançamento (legado, sem rateio).
 * Com rateio, a parcela é outro lançamento do grupo e não entra aqui.
 */
function embeddedArrears(db: DatabaseShape, tx: Transaction): number {
  if (!tx.arrearsId || tx.arrearsYearMonth) return 0;
  if (tx.splitGroupId) {
    const separate = db.transactions.some(
      (item) => item.splitGroupId === tx.splitGroupId && item.id !== tx.id && item.arrearsYearMonth,
    );
    if (separate) return 0;
  }
  const plan = (db.memberArrears ?? []).find((item) => item.id === tx.arrearsId);
  const paid = (plan?.payments ?? []).filter((item) => item.transactionId === tx.id);
  return roundMoney(paid.reduce((sum, item) => sum + item.amount, 0));
}

function formulaTotal(formula: MensalidadeFormula, arrears: number) {
  return roundMoney(formula.total + arrears);
}

/**
 * No prazo ou com atraso: vale o que foi cobrado. Se o valor só bate com uma das duas fórmulas, é ela;
 * senão (iguais ou nenhuma bate), decide a data do pagamento contra o vencimento.
 */
function chargedLate(
  member: Member,
  tx: Transaction,
  clubFeeIncluded: boolean,
  arrears: number,
  schedule: FeeSchedule,
): boolean {
  const dueDate = tx.date.slice(0, 10);
  const onTime = formulaTotal(mensalidadeFormula(member, dueDate, { late: false, clubFeeIncluded }, schedule), arrears);
  const late = formulaTotal(mensalidadeFormula(member, dueDate, { late: true, clubFeeIncluded }, schedule), arrears);
  const matchesOnTime = amountsNear(tx.amount, onTime);
  const matchesLate = amountsNear(tx.amount, late);
  if (matchesOnTime && !matchesLate) return false;
  if (matchesLate && !matchesOnTime) return true;
  return (tx.paidAt ?? dueDate).slice(0, 10) > dueDate;
}

/** Divisão da mensalidade com a composição e o cadastro atuais (sem gravar). */
export function computeAllocation(
  db: DatabaseShape,
  tx: Transaction,
  computedAt = new Date().toISOString(),
): MensalidadeAllocation | null {
  const member = allocatable(db, tx);
  if (!member) return null;
  const schedule = scheduleOf(db);
  const dueDate = tx.date.slice(0, 10);
  const clubFeeIncluded = effectiveClubFeeIncluded(member, tx.clubFeeIncluded);
  const arrears = embeddedArrears(db, tx);
  const late = chargedLate(member, tx, clubFeeIncluded, arrears, schedule);
  const formula = mensalidadeFormula(member, dueDate, { late, clubFeeIncluded }, schedule);
  const expected = formulaTotal(formula, arrears);
  const received = roundMoney(tx.amount);
  return {
    transactionId: tx.id,
    memberId: member.id,
    periodStart: periodFor(schedule, dueDate).startMonth,
    source: formula.source,
    memberBranch: member.branch,
    clubeLtc: Boolean(member.clubeLtc),
    late,
    clubFeeIncluded,
    group: formula.group,
    branch: formula.branch,
    snack: formula.snack,
    club: formula.club,
    dilution: formula.dilution,
    lateFee: formula.lateFee,
    arrears,
    expected,
    received,
    difference: roundMoney(received - expected),
    pendingSplit: formula.pendingSplit,
    basis: allocationBasis(tx),
    computedAt,
  };
}

/**
 * Mantém uma divisão por mensalidade paga: cria as que faltam, refaz as de lançamentos alterados
 * e apaga as de lançamentos que deixaram de ser mensalidade paga. As demais ficam como estão.
 * Devolve quantas foram criadas/refeitas e apagadas.
 */
export function syncAllocations(db: DatabaseShape, now = new Date().toISOString()) {
  const previous = new Map((db.allocations ?? []).map((item) => [item.transactionId, item]));
  const next: MensalidadeAllocation[] = [];
  let computed = 0;
  for (const tx of db.transactions) {
    if (!allocatable(db, tx)) continue;
    const kept = previous.get(tx.id);
    if (kept && kept.basis === allocationBasis(tx) && kept.memberId === tx.memberId) {
      next.push(kept);
      continue;
    }
    const fresh = computeAllocation(db, tx, now);
    if (!fresh) continue;
    next.push(fresh);
    computed += 1;
  }
  const remaining = new Set(next.map((item) => item.transactionId));
  const removed = [...previous.keys()].filter((key) => !remaining.has(key)).length;
  db.allocations = next;
  return { computed, removed };
}

const indexCache = new WeakMap<MensalidadeAllocation[], Map<string, MensalidadeAllocation>>();

/** Divisão gravada por lançamento. O índice vale enquanto a lista não for trocada (syncAllocations troca). */
export function allocationIndex(db: DatabaseShape): Map<string, MensalidadeAllocation> {
  const list = db.allocations ?? [];
  let index = indexCache.get(list);
  if (!index) {
    index = new Map(list.map((item) => [item.transactionId, item]));
    indexCache.set(list, index);
  }
  return index;
}

/** Para onde vai o dinheiro: caixa do grupo inclui diluição, acréscimo por atraso e parcela de dívida. */
export function groupCashOf(allocation: AllocationParts): number {
  return roundMoney(allocation.group + allocation.dilution + allocation.lateFee + allocation.arrears);
}

export function partsTotal(allocation: AllocationParts): number {
  return roundMoney(ALLOCATION_PART_KEYS.reduce((sum, key) => sum + allocation[key], 0));
}

function sameParts(a: AllocationParts, b: AllocationParts) {
  return ALLOCATION_PART_KEYS.every((key) => amountsNear(a[key], b[key]));
}

const SOURCE_LABELS: Record<MensalidadeAllocation['source'], string> = {
  table: 'tabela',
  family: 'valor especial de família',
  custom: 'valor personalizado do cadastro',
};

function brl(n: number) {
  return n.toFixed(2).replace('.', ',');
}

/** Conta por extenso: "R$ 89,50 = 43,00 operacional + 8,00 caixinha do ramo + …". */
export function describeAllocation(allocation: MensalidadeAllocation): string {
  const terms: [number, string][] = [
    [allocation.group, 'operacional'],
    [allocation.branch, 'caixinha do ramo'],
    [allocation.snack, 'lanche'],
    [allocation.club, allocation.late ? 'clube (após o vencimento)' : 'clube (no prazo)'],
    [allocation.dilution, 'diluição dez/jan/fev'],
    [allocation.lateFee, 'acréscimo por atraso'],
    [allocation.arrears, 'parcela de dívida'],
  ];
  const sum = terms
    .filter(([value]) => value > 0)
    .map(([value, label]) => `${brl(value)} ${label}`)
    .join(' + ');
  const context = [
    `composição de ${allocation.periodStart}`,
    SOURCE_LABELS[allocation.source],
    allocation.clubeLtc ? 'sócio Lindóia' : 'não sócio',
  ].join(', ');
  return `R$ ${brl(allocation.expected)} = ${sum || '0,00'} (${context})`;
}

export type ConferenceIssueKind = 'difference' | 'pending_split' | 'drift' | 'unlinked';

export interface ConferenceIssue {
  kind: ConferenceIssueKind;
  transactionId: string;
  date: string;
  paidAt?: string;
  memberId?: string;
  memberName?: string;
  branch: string;
  amount: number;
  message: string;
  allocation?: MensalidadeAllocation;
  /** Divisão com a composição e o cadastro de hoje (só em `drift`). */
  current?: MensalidadeAllocation;
}

export interface DestinationTotals {
  received: number;
  groupCash: number;
  group: number;
  branch: number;
  snack: number;
  club: number;
  dilution: number;
  lateFee: number;
  arrears: number;
  difference: number;
  count: number;
}

export interface ConferenceReport {
  year: number;
  totals: DestinationTotals;
  /** Por ramo do associado; `branch` dentro de cada linha é o valor da caixinha. */
  byBranch: (DestinationTotals & { memberBranch: string })[];
  counts: Record<ConferenceIssueKind, number>;
  issues: ConferenceIssue[];
}

function emptyTotals(): DestinationTotals {
  return {
    received: 0,
    groupCash: 0,
    group: 0,
    branch: 0,
    snack: 0,
    club: 0,
    dilution: 0,
    lateFee: 0,
    arrears: 0,
    difference: 0,
    count: 0,
  };
}

function addTo(totals: DestinationTotals, allocation: MensalidadeAllocation) {
  totals.received = roundMoney(totals.received + allocation.received);
  totals.groupCash = roundMoney(totals.groupCash + groupCashOf(allocation));
  for (const key of ALLOCATION_PART_KEYS) totals[key] = roundMoney(totals[key] + allocation[key]);
  totals.difference = roundMoney(totals.difference + allocation.difference);
  totals.count += 1;
}

const ISSUE_ORDER: ConferenceIssueKind[] = ['unlinked', 'difference', 'drift', 'pending_split'];

/**
 * Conferência do ano (pela data de vencimento): totais por destino e tudo o que precisa de atenção.
 * - difference: valor recebido diferente da soma das partes;
 * - pending_split: divisão ainda não confirmada pela tesouraria;
 * - drift: com a composição/cadastro de hoje a divisão seria outra;
 * - unlinked: mensalidade paga sem associado (não há como dividir).
 */
export function buildConference(db: DatabaseShape, year: number): ConferenceReport {
  const prefix = `${year}-`;
  const index = allocationIndex(db);
  const members = new Map(db.members.map((item) => [item.id, item]));
  const totals = emptyTotals();
  const byBranch = new Map<string, DestinationTotals>();
  const issues: ConferenceIssue[] = [];

  for (const tx of db.transactions) {
    if (!tx.date.startsWith(prefix) || tx.paymentStatus === 'pending' || !isMensalidadeTx(db, tx)) continue;
    const member = tx.memberId ? members.get(tx.memberId) : undefined;
    const base = {
      transactionId: tx.id,
      date: tx.date.slice(0, 10),
      paidAt: tx.paidAt?.slice(0, 10),
      memberId: member?.id,
      memberName: member?.name,
      branch: tx.branch,
      amount: roundMoney(tx.amount),
    };
    const allocation = index.get(tx.id);
    if (!allocation) {
      if (!member) {
        issues.push({
          ...base,
          kind: 'unlinked',
          message: 'Mensalidade paga sem associado: não dá para saber para onde vai cada parte.',
        });
      }
      continue;
    }

    addTo(totals, allocation);
    const branchTotals = byBranch.get(allocation.memberBranch) ?? emptyTotals();
    addTo(branchTotals, allocation);
    byBranch.set(allocation.memberBranch, branchTotals);

    if (!amountsNear(allocation.difference, 0)) {
      const kind = allocation.difference < 0 ? 'a menos' : 'a mais';
      issues.push({
        ...base,
        kind: 'difference',
        allocation,
        message: `Recebido R$ ${brl(allocation.received)}, esperado R$ ${brl(allocation.expected)}: R$ ${brl(Math.abs(allocation.difference))} ${kind}.`,
      });
    }
    if (allocation.pendingSplit) {
      issues.push({
        ...base,
        kind: 'pending_split',
        allocation,
        message: 'O total vale, mas a divisão entre as partes ainda não foi confirmada pela tesouraria.',
      });
    }
    const current = computeAllocation(db, tx, allocation.computedAt);
    if (current && !sameParts(allocation, current)) {
      issues.push({
        ...base,
        kind: 'drift',
        allocation,
        current,
        message:
          'A composição ou o cadastro mudou depois do pagamento: hoje a divisão seria outra (a gravada continua valendo).',
      });
    }
  }

  const counts = { difference: 0, pending_split: 0, drift: 0, unlinked: 0 };
  for (const issue of issues) counts[issue.kind] += 1;
  issues.sort((a, b) => ISSUE_ORDER.indexOf(a.kind) - ISSUE_ORDER.indexOf(b.kind) || a.date.localeCompare(b.date));

  return {
    year,
    totals,
    byBranch: [...byBranch.entries()]
      .map(([memberBranch, value]) => ({ memberBranch, ...value }))
      .sort((a, b) => a.memberBranch.localeCompare(b.memberBranch)),
    counts,
    issues,
  };
}
