import { createTransaction } from '../ledger/transactions';
import { settleMensalidade, settleMensalidades } from '../mensalidades/mensalidades';
import { siblingIdsOf } from '../members/members';
import { isMensalidadeName } from '../statement/statement';
import type { DatabaseShape, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';

/**
 * Permuta: alguém presta um serviço ao grupo no lugar de pagar mensalidade.
 * Regras combinadas com a tesouraria:
 * - abate só meses inteiros, do mais antigo em aberto para o mais novo, no valor pontual com os
 *   descontos de sempre (irmão, filho de chefe, valor especial) e com a taxa do clube;
 * - quem tem filho no grupo recebe o abatimento na mensalidade do filho (e dos irmãos cadastrados);
 * - o que não fecha um mês inteiro (ou tudo, se não houver filho) entra como doação ao grupo;
 * - só vale depois da aprovação da diretoria (admin).
 * No caixa ficam três registros com meio "permuta": as mensalidades pagas, a doação (se houver) e
 * a despesa do serviço com o valor total. Entradas e saída se anulam; nenhum dinheiro passa pelo banco.
 */

export type BarterStatus = 'pending' | 'approving' | 'approved' | 'rejected';

export interface Barter {
  id: string;
  memberId?: string;
  donorName: string;
  service: string;
  amount: number;
  serviceDate: string;
  expenseTypeId: string;
  donationTypeId: string;
  notes: string;
  status: BarterStatus;
  decisionNote: string;
  coveredAmount?: number;
  donationAmount?: number;
  settledIds: string[];
  expenseTransactionId?: string;
  donationTransactionId?: string;
  createdAt: string;
  createdById?: string;
  decidedAt?: string;
  decidedById?: string;
}

export interface BarterPlanItem {
  transactionId: string;
  memberId: string;
  memberName: string;
  /** Vencimento da mensalidade (YYYY-MM-DD). */
  dueDate: string;
  /** Valor que a baixa grava (mensalidade pontual + parcela de acordo que venha junto). */
  amount: number;
}

export interface BarterPlan {
  memberIds: string[];
  items: BarterPlanItem[];
  coveredAmount: number;
  donationAmount: number;
  /** Próxima mensalidade em aberto que o valor não cobriu inteira (para explicar a sobra). */
  nextOpen?: BarterPlanItem;
}

/** O jovem e os irmãos cadastrados que ainda pagam mensalidade. */
export function barterFamily(db: DatabaseShape, memberId?: string): string[] {
  if (!memberId) return [];
  const root = db.members.find((item) => item.id === memberId);
  if (!root) throw new Error('Associado não encontrado');
  const ids = new Set([root.id, ...siblingIdsOf(db, root.id)]);
  return [...ids].filter((id) => db.members.some((item) => item.id === id));
}

function isOpenMensalidade(db: DatabaseShape, tx: Transaction, family: Set<string>) {
  if (tx.type !== 'income' || tx.paymentStatus === 'paid' || !tx.memberId || !family.has(tx.memberId)) return false;
  if (tx.arrearsId) return false;
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return Boolean(movement && isMensalidadeName(movement.name));
}

/**
 * Quais mensalidades a permuta abate. Simula a baixa numa cópia do caixa para usar exatamente o
 * mesmo valor que a baixa real grava (descontos, taxa do clube, parcela de acordo embutida).
 */
export function planBarter(
  db: DatabaseShape,
  input: { memberId?: string; amount: number; serviceDate: string },
  today?: string,
): BarterPlan {
  const amount = roundMoney(input.amount);
  const memberIds = barterFamily(db, input.memberId);
  const family = new Set(memberIds);
  const names = new Map(db.members.map((item) => [item.id, item.name]));
  const open = db.transactions
    .filter((tx) => isOpenMensalidade(db, tx, family))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (names.get(a.memberId!) ?? '').localeCompare(names.get(b.memberId!) ?? '', 'pt-BR'),
    );

  const probe = structuredClone(db);
  const items: BarterPlanItem[] = [];
  let covered = 0;
  let nextOpen: BarterPlanItem | undefined;
  for (const candidate of open) {
    const pendingBefore = new Set(probe.transactions.filter((tx) => tx.paymentStatus !== 'paid').map((tx) => tx.id));
    const settled = settleMensalidade(
      probe,
      {
        transactionId: candidate.id,
        timing: 'on_time',
        paidAt: input.serviceDate,
        notifyReceipt: false,
        method: 'barter',
      },
      'barter-preview',
      today,
    );
    if (!settled) continue;
    const value = roundMoney(
      probe.transactions
        .filter((tx) => pendingBefore.has(tx.id) && tx.paymentStatus === 'paid')
        .reduce((sum, tx) => sum + tx.amount, 0),
    );
    const item: BarterPlanItem = {
      transactionId: candidate.id,
      memberId: candidate.memberId!,
      memberName: names.get(candidate.memberId!) ?? '',
      dueDate: candidate.date.slice(0, 10),
      amount: value,
    };
    // Só meses inteiros, sem pular: o mês que não cabe encerra o abatimento.
    if (roundMoney(covered + value) > amount) {
      nextOpen = item;
      break;
    }
    covered = roundMoney(covered + value);
    items.push(item);
  }

  return {
    memberIds,
    items,
    coveredAmount: covered,
    donationAmount: roundMoney(amount - covered),
    nextOpen,
  };
}

export interface BarterApplied {
  settledIds: string[];
  coveredAmount: number;
  donationAmount: number;
  expenseTransactionId: string;
  donationTransactionId?: string;
}

export function barterExternalId(barterId: string, part: 'servico' | 'doacao') {
  return `permuta:${barterId}:${part}`;
}

/** Aprovação: baixa as mensalidades, lança a doação (sobra) e a despesa do serviço, tudo com meio permuta. */
export function applyBarter(db: DatabaseShape, barter: Barter, userId: string, today?: string): BarterApplied {
  if (db.transactions.some((tx) => tx.externalId === barterExternalId(barter.id, 'servico'))) {
    throw new Error('Esta permuta já foi lançada no caixa');
  }
  const expenseType = db.movementTypes.find((item) => item.id === barter.expenseTypeId);
  if (!expenseType) throw new Error('Tipo da despesa do serviço não encontrado');
  const donationType = db.movementTypes.find((item) => item.id === barter.donationTypeId);
  if (!donationType) throw new Error('Tipo da doação não encontrado');

  const plan = planBarter(db, barter, today);
  const settledIds: string[] = [];
  let covered = 0;
  if (plan.items.length) {
    const before = new Set(db.transactions.filter((tx) => tx.paymentStatus !== 'paid').map((tx) => tx.id));
    settleMensalidades(
      db,
      {
        transactionIds: plan.items.map((item) => item.transactionId),
        timing: 'on_time',
        paidAt: barter.serviceDate,
        notifyReceipt: false,
        method: 'barter',
      },
      userId,
      today,
    );
    for (const tx of db.transactions) {
      if (!before.has(tx.id) || tx.paymentStatus !== 'paid') continue;
      settledIds.push(tx.id);
      covered = roundMoney(covered + tx.amount);
    }
  }
  const donation = roundMoney(barter.amount - covered);
  if (donation < 0) throw new Error('As mensalidades abatidas passaram do valor do serviço');

  const label = `${barter.service} — ${barter.donorName}`;
  let donationTransactionId: string | undefined;
  if (donation > 0) {
    const tx = createTransaction(
      db,
      {
        date: barter.serviceDate,
        type: 'income',
        nature: 'variable',
        movementTypeId: donationType.id,
        description: `Doação por permuta: ${label}`,
        amount: donation,
        branch: 'grupo',
        method: 'other',
        paymentStatus: 'paid',
        paidAt: barter.serviceDate,
        memberId: barter.memberId,
        notes: covered > 0 ? `Sobra da permuta depois de abater ${plan.items.length} mensalidade(s).` : undefined,
      },
      userId,
    );
    tx.method = 'barter';
    tx.externalId = barterExternalId(barter.id, 'doacao');
    donationTransactionId = tx.id;
  }

  const expense = createTransaction(
    db,
    {
      date: barter.serviceDate,
      type: 'expense',
      nature: 'variable',
      movementTypeId: expenseType.id,
      description: `Serviço recebido em permuta: ${label}`,
      amount: barter.amount,
      branch: 'grupo',
      method: 'other',
      paymentStatus: 'paid',
      paidAt: barter.serviceDate,
      notes: barter.notes || undefined,
    },
    userId,
  );
  expense.method = 'barter';
  expense.externalId = barterExternalId(barter.id, 'servico');

  return {
    settledIds,
    coveredAmount: covered,
    donationAmount: donation,
    expenseTransactionId: expense.id,
    donationTransactionId,
  };
}
