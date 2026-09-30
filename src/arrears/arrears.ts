import { createdAudit, updatedAudit } from '../shared/audit';
import { id } from '../shared/id';
import type {
  ArrearsChargeMode,
  ArrearsPayment,
  ArrearsPaymentSource,
  DatabaseShape,
  MemberArrears,
  PaymentMethod,
  Transaction,
} from '../shared/types';
import { roundMoney } from '../shared/types';
import { dueDateForMonth, dueDayOf, MENSALIDADE_MONTHS, todayISO } from '../mensalidades/mensalidades';
import { effectiveClubFeeIncluded, expectedMensalidadeAmount } from '../mensalidades/fee-table';
import { splitTransaction } from '../ledger/split';

export const ARREARS_MOVEMENT_NAME = 'Acordo / dívida diluída';

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

export function parseYearMonth(value: string): { year: number; month: number } {
  const [y, m] = value.slice(0, 7).split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error('Competência inválida (use YYYY-MM)');
  return { year: y, month: m };
}

export function yearMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Meses do plano em ordem (só Mar–Nov; avança o ano se precisar). */
export function planYearMonths(startYearMonth: string, totalCount: number): string[] {
  const { year: startY, month: startM } = parseYearMonth(startYearMonth);
  const out: string[] = [];
  let year = startY;
  let month = startM;
  let guard = 0;
  while (out.length < totalCount && guard < 48) {
    guard += 1;
    if (MENSALIDADE_MONTHS.includes(month)) {
      out.push(yearMonthKey(year, month));
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  if (out.length < totalCount) throw new Error('Não foi possível montar o calendário de parcelas');
  return out;
}

export function installmentForYearMonth(plan: MemberArrears, yearMonth: string): number {
  if (plan.status !== 'active' || plan.balance <= 0 || plan.remainingCount <= 0) return 0;
  const months = planYearMonths(plan.startYearMonth, plan.totalCount);
  const paidSlots = plan.totalCount - plan.remainingCount;
  const idx = months.indexOf(yearMonth.slice(0, 7));
  if (idx < 0 || idx < paidSlots) return 0;
  if (plan.remainingCount === 1) return roundMoney(plan.balance);
  return roundMoney(plan.installmentAmount);
}

export function activeEmbedPlan(db: DatabaseShape, memberId: string): MemberArrears | undefined {
  return (db.memberArrears ?? []).find(
    (item) => item.memberId === memberId && item.status === 'active' && item.chargeMode === 'embed',
  );
}

export function ensureArrearsMovementType(db: DatabaseShape, userId: string) {
  const existing = db.movementTypes.find((item) => item.name === ARREARS_MOVEMENT_NAME);
  if (existing) {
    if (!existing.active) {
      existing.active = true;
      Object.assign(existing, updatedAudit(userId));
    }
    return existing;
  }
  const created = {
    id: id(),
    name: ARREARS_MOVEMENT_NAME,
    direction: 'income' as const,
    description: 'Parcelas de acordo de dívida diluída (atrasados de anos anteriores)',
    pixKey: '',
    branch: 'grupo' as const,
    active: true,
    ...createdAudit(userId),
  };
  db.movementTypes.push(created);
  return created;
}

export function listArrears(db: DatabaseShape) {
  return [...(db.memberArrears ?? [])].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'active') return -1;
      if (b.status === 'active') return 1;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function createArrearsPlan(
  db: DatabaseShape,
  input: {
    memberId: string;
    amount: number;
    installments: number;
    startYearMonth: string;
    chargeMode: ArrearsChargeMode;
    note?: string;
  },
  userId: string,
): MemberArrears {
  if (!db.memberArrears) db.memberArrears = [];
  const member = db.members.find((item) => item.id === input.memberId);
  if (!member) throw new Error('Associado não encontrado');
  const amount = roundMoney(input.amount);
  const installments = Math.floor(input.installments);
  if (!(amount > 0)) throw new Error('Informe o valor da dívida');
  if (installments < 2 || installments > 12) throw new Error('Parcelas: mínimo 2, máximo 12');
  parseYearMonth(input.startYearMonth);
  planYearMonths(input.startYearMonth, installments);
  if (input.chargeMode !== 'embed' && input.chargeMode !== 'separate') {
    throw new Error('Modo de cobrança inválido');
  }
  const open = db.memberArrears.find((item) => item.memberId === input.memberId && item.status === 'active');
  if (open) throw new Error('Já existe um acordo ativo para este associado. Quite ou cancele antes.');

  const installmentAmount = roundMoney(amount / installments);
  const plan: MemberArrears = {
    id: id(),
    memberId: input.memberId,
    originalAmount: amount,
    balance: amount,
    installmentAmount,
    totalCount: installments,
    remainingCount: installments,
    startYearMonth: input.startYearMonth.slice(0, 7),
    chargeMode: input.chargeMode,
    note: (input.note ?? '').trim(),
    status: 'active',
    ...createdAudit(userId),
  };
  db.memberArrears.push(plan);
  if (plan.chargeMode === 'embed') {
    applyEmbedToPendingMensalidades(db, plan, userId);
  }
  return plan;
}

export function cancelArrearsPlan(db: DatabaseShape, planId: string, userId: string): MemberArrears {
  const plan = (db.memberArrears ?? []).find((item) => item.id === planId);
  if (!plan) throw new Error('Acordo não encontrado');
  if (plan.status !== 'active') throw new Error('Acordo já encerrado');
  if (plan.chargeMode === 'embed') {
    stripEmbedFromPendingMensalidades(db, plan, userId);
  }
  if (plan.chargeMode === 'separate') {
    removeUnpaidSeparateTxs(db, plan.id);
  }
  plan.status = 'cancelled';
  Object.assign(plan, updatedAudit(userId));
  return plan;
}

export function settleArrearsPlan(
  db: DatabaseShape,
  planId: string,
  userId: string,
  opts?: { recordPayment?: boolean; paidAt?: string; method?: PaymentMethod; note?: string },
): MemberArrears {
  const plan = (db.memberArrears ?? []).find((item) => item.id === planId);
  if (!plan) throw new Error('Acordo não encontrado');
  if (plan.status !== 'active') throw new Error('Acordo já encerrado');
  const recordPayment = opts?.recordPayment !== false;
  if (recordPayment && plan.balance > 0) {
    return applyArrearsCashPayment(
      db,
      planId,
      {
        amount: plan.balance,
        paidAt: opts?.paidAt,
        method: opts?.method,
        note: opts?.note ?? 'Quitação do saldo restante',
      },
      userId,
    ).plan;
  }
  if (plan.chargeMode === 'embed') {
    stripEmbedFromPendingMensalidades(db, plan, userId);
  }
  if (plan.chargeMode === 'separate') {
    removeUnpaidSeparateTxs(db, plan.id);
  }
  plan.balance = 0;
  plan.remainingCount = 0;
  plan.status = 'settled';
  Object.assign(plan, updatedAudit(userId));
  return plan;
}

/** Registra pagamento de uma parcela (baixa separate ou mensalidade embed). */
export function registerArrearsInstallmentPaid(
  db: DatabaseShape,
  planId: string,
  yearMonth: string,
  userId: string,
  meta?: {
    source?: ArrearsPaymentSource;
    transactionId?: string;
    method?: PaymentMethod;
    paidAt?: string;
  },
): MemberArrears | null {
  const plan = (db.memberArrears ?? []).find((item) => item.id === planId);
  if (!plan || plan.status !== 'active') return null;
  const due = installmentForYearMonth(plan, yearMonth);
  if (!(due > 0)) return plan;
  const wasEmbed = plan.chargeMode === 'embed';
  if (wasEmbed) stripEmbedFromPendingMensalidades(db, plan, userId);
  plan.balance = roundMoney(Math.max(0, plan.balance - due));
  plan.remainingCount = Math.max(0, plan.remainingCount - 1);
  if (plan.remainingCount === 0 || plan.balance <= 0) {
    plan.balance = 0;
    plan.remainingCount = 0;
    plan.status = 'settled';
  }
  pushArrearsPayment(plan, {
    amount: due,
    paidAt: meta?.paidAt ?? todayISO(),
    method: meta?.method ?? 'pix',
    source: meta?.source ?? (plan.chargeMode === 'separate' ? 'separate' : 'mensalidade'),
    transactionId: meta?.transactionId,
    yearMonth: yearMonth.slice(0, 7),
    userId,
  });
  Object.assign(plan, updatedAudit(userId));
  if (wasEmbed && plan.status === 'active') {
    applyEmbedToPendingMensalidades(db, plan, userId);
  }
  return plan;
}

export function paidTotalOf(plan: MemberArrears): number {
  const logged = roundMoney((plan.payments ?? []).reduce((sum, item) => sum + item.amount, 0));
  if (logged > 0) return Math.min(logged, plan.originalAmount);
  return roundMoney(Math.max(0, plan.originalAmount - plan.balance));
}

export function arrearsProgress(plan: MemberArrears) {
  const paidTotal = paidTotalOf(plan);
  const pct = plan.originalAmount > 0 ? Math.min(100, roundMoney((paidTotal / plan.originalAmount) * 100)) : 100;
  return {
    originalAmount: plan.originalAmount,
    paidTotal,
    balance: plan.balance,
    percentPaid: pct,
    installmentsPaid: Math.max(0, plan.totalCount - plan.remainingCount),
    installmentsRemaining: plan.remainingCount,
    installmentAmount: plan.installmentAmount,
  };
}

function syncRemainingAfterCashPayment(plan: MemberArrears) {
  if (plan.balance <= 0) {
    plan.balance = 0;
    plan.remainingCount = 0;
    plan.status = 'settled';
    return;
  }
  const slots = Math.max(1, Math.ceil(plan.balance / plan.installmentAmount - 1e-9));
  plan.remainingCount = Math.min(plan.totalCount, slots);
  plan.status = 'active';
}

function pushArrearsPayment(
  plan: MemberArrears,
  input: {
    amount: number;
    paidAt: string;
    method: PaymentMethod;
    source: ArrearsPaymentSource;
    transactionId?: string;
    yearMonth?: string;
    note?: string;
    userId: string;
  },
) {
  if (!plan.payments) plan.payments = [];
  const payment: ArrearsPayment = {
    id: id(),
    amount: roundMoney(input.amount),
    paidAt: input.paidAt.slice(0, 10),
    method: input.method,
    source: input.source,
    createdAt: new Date().toISOString(),
    createdBy: input.userId,
  };
  if (input.transactionId) payment.transactionId = input.transactionId;
  if (input.yearMonth) payment.yearMonth = input.yearMonth.slice(0, 7);
  if (input.note?.trim()) payment.note = input.note.trim();
  plan.payments.push(payment);
  return payment;
}

function removeUnpaidSeparateTxs(db: DatabaseShape, planId: string) {
  db.transactions = db.transactions.filter((tx) => !(tx.arrearsId === planId && tx.paymentStatus !== 'paid'));
}

function syncSeparatePendingAfterPayment(db: DatabaseShape, plan: MemberArrears, userId: string) {
  if (plan.status !== 'active') {
    removeUnpaidSeparateTxs(db, plan.id);
    return;
  }
  for (const tx of db.transactions) {
    if (tx.arrearsId !== plan.id || tx.paymentStatus === 'paid' || !tx.arrearsYearMonth) continue;
    const due = installmentForYearMonth(plan, tx.arrearsYearMonth);
    if (!(due > 0)) {
      db.transactions = db.transactions.filter((item) => item.id !== tx.id);
      continue;
    }
    if (tx.amount !== due) {
      tx.amount = due;
      Object.assign(tx, updatedAudit(userId));
    }
  }
}

/**
 * Registra pagamento avulso (adiantamento, parcial ou quitação) no fluxo e no saldo do acordo.
 * No modo embutido, recalcula o valor das mensalidades pendentes.
 */
export function applyArrearsCashPayment(
  db: DatabaseShape,
  planId: string,
  input: {
    amount: number;
    paidAt?: string;
    method?: PaymentMethod;
    note?: string;
  },
  userId: string,
): { plan: MemberArrears; transaction: Transaction; payment: ArrearsPayment } {
  const plan = (db.memberArrears ?? []).find((item) => item.id === planId);
  if (!plan) throw new Error('Acordo não encontrado');
  if (plan.status !== 'active') throw new Error('Acordo já encerrado');
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new Error('Informe o valor do pagamento');
  if (amount > plan.balance + 0.001) {
    throw new Error(`Valor maior que o saldo restante (${plan.balance.toFixed(2)})`);
  }

  const member = db.members.find((item) => item.id === plan.memberId);
  if (!member) throw new Error('Associado não encontrado');
  const paidAt = (input.paidAt ?? todayISO()).slice(0, 10);
  const method = input.method ?? 'pix';
  const movement = ensureArrearsMovementType(db, userId);

  if (plan.chargeMode === 'embed') {
    stripEmbedFromPendingMensalidades(db, plan, userId);
  }

  const tx: Transaction = {
    id: id(),
    date: paidAt,
    type: 'income',
    nature: 'variable',
    movementTypeId: movement.id,
    description: `Pagamento acordo — ${member.name}${input.note?.trim() ? ` (${input.note.trim()})` : ''}`,
    amount,
    branch: member.branch,
    method,
    paymentStatus: 'paid',
    paidAt,
    memberId: member.id,
    arrearsId: plan.id,
    notes: input.note?.trim() || undefined,
    ...createdAudit(userId),
  };
  db.transactions.push(tx);

  plan.balance = roundMoney(Math.max(0, plan.balance - amount));
  syncRemainingAfterCashPayment(plan);
  const payment = pushArrearsPayment(plan, {
    amount,
    paidAt,
    method,
    source: 'manual',
    transactionId: tx.id,
    note: input.note,
    userId,
  });
  Object.assign(plan, updatedAudit(userId));

  if (plan.chargeMode === 'embed' && plan.status === 'active') {
    applyEmbedToPendingMensalidades(db, plan, userId);
  }
  if (plan.chargeMode === 'separate') {
    syncSeparatePendingAfterPayment(db, plan, userId);
  }

  return { plan, transaction: tx, payment };
}

export function listArrearsPayments(db: DatabaseShape, planId: string) {
  const plan = (db.memberArrears ?? []).find((item) => item.id === planId);
  if (!plan) throw new Error('Acordo não encontrado');
  const payments = [...(plan.payments ?? [])].sort(
    (a, b) => b.paidAt.localeCompare(a.paidAt) || b.createdAt.localeCompare(a.createdAt),
  );
  return {
    plan,
    progress: arrearsProgress(plan),
    payments,
  };
}

export function generateArrearsMonth(
  db: DatabaseShape,
  planId: string,
  yearMonth: string,
  userId: string,
): Transaction {
  const plan = (db.memberArrears ?? []).find((item) => item.id === planId);
  if (!plan) throw new Error('Acordo não encontrado');
  if (plan.status !== 'active') throw new Error('Acordo encerrado');
  if (plan.chargeMode !== 'separate') {
    throw new Error('Geração de lançamento só no modo “lançamento à parte”');
  }
  const ym = yearMonth.slice(0, 7);
  const amount = installmentForYearMonth(plan, ym);
  if (!(amount > 0)) throw new Error('Não há parcela a gerar para esta competência');
  const existing = db.transactions.find(
    (tx) => tx.arrearsId === plan.id && tx.arrearsYearMonth === ym && tx.paymentStatus !== 'paid',
  );
  if (existing) return existing;
  const paidExisting = db.transactions.find(
    (tx) => tx.arrearsId === plan.id && tx.arrearsYearMonth === ym && tx.paymentStatus === 'paid',
  );
  if (paidExisting) throw new Error('Parcela desta competência já está paga');

  const member = db.members.find((item) => item.id === plan.memberId);
  if (!member) throw new Error('Associado não encontrado');
  const { year, month } = parseYearMonth(ym);
  const movement = ensureArrearsMovementType(db, userId);
  const dueDay = dueDayOf(db);
  const date = dueDateForMonth(year, month, dueDay);
  const tx: Transaction = {
    id: id(),
    date,
    type: 'income',
    nature: 'variable',
    movementTypeId: movement.id,
    description: `Dívida diluída ${MONTH_NAMES[month]} ${year} — ${member.name}`,
    amount,
    branch: member.branch,
    method: 'pix',
    paymentStatus: 'pending',
    memberId: member.id,
    arrearsId: plan.id,
    arrearsYearMonth: ym,
    ...createdAudit(userId),
  };
  db.transactions.push(tx);
  return tx;
}

/** Gera parcelas com competência ≤ monthLimit (YYYY-MM), retroativo incluso. */
export function generateArrearsDue(
  db: DatabaseShape,
  planId: string,
  monthLimit: string,
  userId: string,
): Transaction[] {
  const plan = (db.memberArrears ?? []).find((item) => item.id === planId);
  if (!plan) throw new Error('Acordo não encontrado');
  if (plan.chargeMode !== 'separate') {
    throw new Error('Geração em lote só no modo “lançamento à parte”');
  }
  const limit = monthLimit.slice(0, 7);
  const created: Transaction[] = [];
  for (const ym of planYearMonths(plan.startYearMonth, plan.totalCount)) {
    if (ym > limit) break;
    if (!(installmentForYearMonth(plan, ym) > 0)) continue;
    const exists = db.transactions.some((tx) => tx.arrearsId === plan.id && tx.arrearsYearMonth === ym);
    if (exists) continue;
    created.push(generateArrearsMonth(db, planId, ym, userId));
  }
  return created;
}

export function embedMetaForCell(
  db: DatabaseShape,
  memberId: string,
  year: number,
  month: number,
  status: string,
): { arrearsInstallment?: number; arrearsPlanId?: string; extra: number } {
  if (status === 'none' || status === 'paid') return { extra: 0 };
  const plan = activeEmbedPlan(db, memberId);
  if (!plan) return { extra: 0 };
  const extra = installmentForYearMonth(plan, yearMonthKey(year, month));
  if (!(extra > 0)) return { extra: 0 };
  return { arrearsInstallment: extra, arrearsPlanId: plan.id, extra };
}

function applyEmbedToPendingMensalidades(db: DatabaseShape, plan: MemberArrears, userId: string) {
  for (const ym of planYearMonths(plan.startYearMonth, plan.totalCount)) {
    if (!(installmentForYearMonth(plan, ym) > 0)) continue;
    const { year, month } = parseYearMonth(ym);
    const tx = findPendingMensalidadeTx(db, plan.memberId, year, month);
    if (!tx) continue;
    // Já rateado corretamente: só re-sincroniza se a parcela mudou.
    if (tx.splitGroupId) {
      const peers = db.transactions.filter((item) => item.splitGroupId === tx.splitGroupId);
      const arrearsPart = peers.find((item) => item.arrearsId === plan.id && item.arrearsYearMonth === ym);
      const due = installmentForYearMonth(plan, ym);
      if (arrearsPart && Math.abs(arrearsPart.amount - due) < 0.02) continue;
    }
    syncMensalidadeArrearsEmbed(db, tx.id, userId, todayISO(), { recalculateBase: false });
  }
}

/** Reaplica rateio mensalidade+acordo em todos os planos embed ativos (corrige legado somado). */
export function repairActiveEmbedSplits(db: DatabaseShape, userId: string): number {
  let fixed = 0;
  for (const plan of db.memberArrears ?? []) {
    if (plan.status !== 'active' || plan.chargeMode !== 'embed') continue;
    for (const ym of planYearMonths(plan.startYearMonth, plan.totalCount)) {
      if (!(installmentForYearMonth(plan, ym) > 0)) continue;
      const { year, month } = parseYearMonth(ym);
      const tx = findPendingMensalidadeTx(db, plan.memberId, year, month);
      if (!tx) continue;
      const beforeSplit = tx.splitGroupId;
      const parts = syncMensalidadeArrearsEmbed(db, tx.id, userId, todayISO(), { recalculateBase: true });
      if (parts && !beforeSplit) fixed += 1;
      else if (parts) fixed += 1;
    }
  }
  return fixed;
}

function stripEmbedFromPendingMensalidades(db: DatabaseShape, plan: MemberArrears, userId: string) {
  for (const ym of planYearMonths(plan.startYearMonth, plan.totalCount)) {
    const { year, month } = parseYearMonth(ym);
    const tx = findPendingMensalidadeTx(db, plan.memberId, year, month);
    if (!tx) continue;
    removeArrearsEmbedSplit(db, tx, plan.id, userId, todayISO(), { recalculateBase: false });
  }
}

export function findPendingMensalidadeTx(
  db: DatabaseShape,
  memberId: string,
  year: number,
  month: number,
): Transaction | undefined {
  return db.transactions.find(
    (item) =>
      item.memberId === memberId &&
      item.paymentStatus === 'pending' &&
      Number(item.date.slice(0, 4)) === year &&
      Number(item.date.slice(5, 7)) === month &&
      isLikelyMensalidade(db, item),
  );
}

/** Remove rateio de acordo e deixa só a mensalidade (valor base). */
export function removeArrearsEmbedSplit(
  db: DatabaseShape,
  mensalidadeTx: Transaction,
  planId: string,
  userId: string,
  today = todayISO(),
  opts?: { recalculateBase?: boolean },
) {
  const recalculateBase = opts?.recalculateBase === true;
  const ym = yearMonthKey(Number(mensalidadeTx.date.slice(0, 4)), Number(mensalidadeTx.date.slice(5, 7)));
  const plan = (db.memberArrears ?? []).find((item) => item.id === planId);
  const knownExtra = plan ? installmentForYearMonth(plan, ym) : 0;
  let preservedBase: number | undefined;
  if (!recalculateBase) {
    if (mensalidadeTx.splitGroupId) {
      preservedBase = mensalidadeTx.amount;
    } else if (mensalidadeTx.arrearsId === planId && knownExtra > 0) {
      preservedBase = roundMoney(Math.max(0.01, mensalidadeTx.amount - knownExtra));
    } else {
      preservedBase = mensalidadeTx.amount;
    }
  }

  const primary = consolidatePendingGroup(db, mensalidadeTx);
  if (primary.paymentStatus === 'paid') return;
  const member = primary.memberId ? db.members.find((item) => item.id === primary.memberId) : undefined;
  if (member && recalculateBase) {
    const club = effectiveClubFeeIncluded(member, primary.clubFeeIncluded);
    primary.amount = roundMoney(expectedMensalidadeAmount(member, primary.date.slice(0, 10), today, club));
    primary.clubFeeIncluded = club;
  } else if (preservedBase != null) {
    primary.amount = preservedBase;
  } else if (member) {
    const club = effectiveClubFeeIncluded(member, primary.clubFeeIncluded);
    primary.amount = roundMoney(expectedMensalidadeAmount(member, primary.date.slice(0, 10), today, club));
    primary.clubFeeIncluded = club;
  }
  clearMensalidadeEmbedLink(primary);
  Object.assign(primary, updatedAudit(userId));
}

/**
 * Garante rateio mensalidade + parcela do acordo (filhos no fluxo).
 * Se não houver parcela, remove o rateio de acordo e restaura a mensalidade.
 */
export function syncMensalidadeArrearsEmbed(
  db: DatabaseShape,
  mensalidadeTxId: string,
  userId: string,
  today = todayISO(),
  opts?: { recalculateBase?: boolean },
): Transaction[] | null {
  const recalculateBase = opts?.recalculateBase !== false;
  let tx = db.transactions.find((item) => item.id === mensalidadeTxId);
  if (!tx || tx.paymentStatus === 'paid') return null;
  if (!isLikelyMensalidade(db, tx)) {
    if (tx.splitGroupId) {
      const mens = db.transactions.find(
        (item) => item.splitGroupId === tx!.splitGroupId && isLikelyMensalidade(db, item),
      );
      if (!mens) return null;
      tx = mens;
    } else {
      return null;
    }
  }

  const member = tx.memberId ? db.members.find((item) => item.id === tx!.memberId) : undefined;
  if (!member) return null;
  const dueDate = tx.date.slice(0, 10);
  const year = Number(dueDate.slice(0, 4));
  const month = Number(dueDate.slice(5, 7));
  const ym = yearMonthKey(year, month);
  const club = effectiveClubFeeIncluded(member, tx.clubFeeIncluded);
  const tableBase = roundMoney(expectedMensalidadeAmount(member, dueDate, today, club));
  const embed = embedMetaForCell(db, member.id, year, month, 'pending');

  let preservedBase = tx.amount;
  if (tx.splitGroupId) {
    preservedBase = tx.amount;
  } else if (embed.extra > 0) {
    const combined = roundMoney(tableBase + embed.extra);
    // Legado: mensalidade já somada com a parcela (sem rateio).
    if (Math.abs(tx.amount - combined) < 0.02) {
      preservedBase = tableBase;
    } else if (tx.arrearsId && !tx.arrearsYearMonth) {
      preservedBase = roundMoney(Math.max(0.01, tx.amount - embed.extra));
    }
  }

  if (!(embed.extra > 0) || !embed.arrearsPlanId) {
    removeArrearsEmbedSplit(db, tx, tx.arrearsId ?? '', userId, today, { recalculateBase });
    return null;
  }

  const plan = (db.memberArrears ?? []).find((item) => item.id === embed.arrearsPlanId);
  if (!plan) return null;

  // Já existe lançamento da parcela (pago ou pendente) fora deste rateio → não reagrupar.
  const existingArrearsTx = db.transactions.find(
    (item) => item.arrearsId === plan.id && item.arrearsYearMonth === ym && item.id !== tx.id,
  );
  if (existingArrearsTx && existingArrearsTx.splitGroupId !== tx.splitGroupId) {
    return null;
  }
  // Uma das partes já foi paga de forma independente → não recria rateio.
  if (existingArrearsTx?.paymentStatus === 'paid' || tx.paymentStatus === 'paid') {
    return null;
  }

  const primary = consolidatePendingGroup(db, tx);
  const base = recalculateBase ? tableBase : preservedBase;
  primary.amount = roundMoney(base + embed.extra);
  primary.clubFeeIncluded = club;
  clearMensalidadeEmbedLink(primary);
  Object.assign(primary, updatedAudit(userId));

  const arrearsMovement = ensureArrearsMovementType(db, userId);
  const mensalidadeMovementId = primary.movementTypeId;
  const monthLabel = MONTH_NAMES[month] ?? String(month);
  const parts = splitTransaction(
    db,
    primary.id,
    [
      {
        amount: base,
        movementTypeId: mensalidadeMovementId,
        description: `Mensalidade ${monthLabel} ${year} — ${member.name}`,
        memberId: member.id,
      },
      {
        amount: embed.extra,
        movementTypeId: arrearsMovement.id,
        description: `Dívida diluída ${monthLabel} ${year} — ${member.name}`,
        memberId: member.id,
      },
    ],
    userId,
  );

  const arrearsPart = parts[1];
  if (arrearsPart) {
    arrearsPart.arrearsId = plan.id;
    arrearsPart.arrearsYearMonth = ym;
    arrearsPart.nature = 'variable';
    Object.assign(arrearsPart, updatedAudit(userId));
  }
  clearMensalidadeEmbedLink(parts[0]);
  return parts;
}

/** Consolida rateio pendente e devolve a parte principal (índice 1). */
function consolidatePendingGroup(db: DatabaseShape, seed: Transaction): Transaction {
  if (!seed.splitGroupId) return seed;
  const groupId = seed.splitGroupId;
  const peers = db.transactions.filter((item) => item.splitGroupId === groupId);
  if (peers.some((item) => item.paymentStatus === 'paid')) return seed;
  const primary =
    peers.find((item) => item.splitIndex === 1) ??
    peers.find((item) => isLikelyMensalidade(db, item)) ??
    peers.find((item) => item.id === seed.id) ??
    peers[0];
  if (!primary) return seed;
  const total = roundMoney(primary.splitTotal ?? peers.reduce((sum, item) => sum + item.amount, 0));
  const drop = new Set(peers.filter((item) => item.id !== primary.id).map((item) => item.id));
  if (drop.size) {
    db.transactions = db.transactions.filter((item) => !drop.has(item.id));
  }
  primary.amount = total;
  delete primary.splitGroupId;
  delete primary.splitTotal;
  delete primary.splitIndex;
  delete primary.splitCount;
  return primary;
}

/** Marca mensalidade com parcela de acordo embutida (sem arrearsYearMonth, para não baixar via updateTransaction). */
export function stampMensalidadeEmbedLink(tx: Transaction, planId: string) {
  tx.arrearsId = planId;
  delete tx.arrearsYearMonth;
}

export function clearMensalidadeEmbedLink(tx: Transaction) {
  if (tx.arrearsYearMonth) return;
  delete tx.arrearsId;
}

export type ArrearsTxMarker = 'embed' | 'agreement';

/** Classifica o lançamento para indicador no fluxo: mensalidade+parcela ou só acordo. */
export function resolveArrearsTxMarker(db: DatabaseShape, tx: Transaction): ArrearsTxMarker | null {
  if (tx.arrearsId && tx.arrearsYearMonth) return 'agreement';
  if (tx.arrearsId && isLikelyMensalidade(db, tx) && !tx.arrearsYearMonth) return 'embed';
  if (tx.splitGroupId) {
    const peers = db.transactions.filter((item) => item.splitGroupId === tx.splitGroupId);
    const hasArrearsChild = peers.some((item) => item.arrearsId && item.arrearsYearMonth);
    if (hasArrearsChild) {
      if (isLikelyMensalidade(db, tx)) return 'embed';
      if (tx.arrearsId) return 'agreement';
    }
  }
  for (const plan of db.memberArrears ?? []) {
    for (const payment of plan.payments ?? []) {
      if (payment.transactionId !== tx.id) continue;
      return payment.source === 'mensalidade' ? 'embed' : 'agreement';
    }
  }
  return null;
}

function isLikelyMensalidade(db: DatabaseShape, tx: Transaction) {
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return Boolean(movement && /mensalidade/i.test(movement.name));
}

function clearSplitMeta(tx: Transaction) {
  delete tx.splitGroupId;
  delete tx.splitTotal;
  delete tx.splitIndex;
  delete tx.splitCount;
}

/**
 * Se mensalidade e parcela de acordo estão no mesmo rateio e passam a ter
 * status/data de pagamento diferentes (pagamento separado), desfaz o rateio
 * e deixa cada um como lançamento único.
 */
export function dissolveMensalidadeArrearsSplitIfSeparate(db: DatabaseShape, tx: Transaction, userId: string): boolean {
  if (!tx.splitGroupId) return false;
  const groupId = tx.splitGroupId;
  const peers = db.transactions.filter((item) => item.splitGroupId === groupId);
  if (peers.length < 2) return false;

  const hasMensalidade = peers.some((item) => isLikelyMensalidade(db, item));
  const hasArrears = peers.some((item) => Boolean(item.arrearsId && item.arrearsYearMonth));
  if (!hasMensalidade || !hasArrears) return false;

  const paid = peers.filter((item) => item.paymentStatus === 'paid');
  const pending = peers.filter((item) => item.paymentStatus !== 'paid');

  let shouldDissolve = false;
  if (paid.length > 0 && pending.length > 0) {
    // Uma parte paga e outra ainda pendente.
    shouldDissolve = true;
  } else if (peers.every((item) => item.paymentStatus === 'paid')) {
    const dates = new Set(peers.map((item) => (item.paidAt ?? item.date).slice(0, 10)));
    shouldDissolve = dates.size > 1;
  }

  if (!shouldDissolve) return false;

  for (const peer of peers) {
    clearSplitMeta(peer);
    Object.assign(peer, updatedAudit(userId));
  }
  return true;
}
