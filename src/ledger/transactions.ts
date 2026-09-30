import { createdAudit, updatedAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { BranchId, DatabaseShape, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';
import type { CreateTransactionInput, PatchTransactionInput } from '../shared/http/schemas';
import { resolveGuardianId } from '../members/members';
import { todayISO } from '../mensalidades/mensalidades';
import { isMensalidadeName, sicrediPayer } from '../statement/statement';
import { registerArrearsInstallmentPaid, dissolveMensalidadeArrearsSplitIfSeparate } from '../arrears/arrears';

export function stampPaidAt(
  tx: Transaction,
  movementName: string,
  status: Transaction['paymentStatus'],
  paidAt?: string | null,
  today = todayISO(),
) {
  tx.paymentStatus = status;
  if (status !== 'paid') {
    delete tx.paidAt;
    return;
  }
  if (paidAt) {
    tx.paidAt = paidAt;
    return;
  }
  if (tx.paidAt) return;
  tx.paidAt = isMensalidadeName(movementName) ? today : tx.date;
}

export function listTransactions(
  db: DatabaseShape,
  filters: {
    from: string;
    to: string;
    branch?: BranchId;
    type?: Transaction['type'];
    nature?: Transaction['nature'];
  },
) {
  let list = db.transactions.filter((item) => item.date >= filters.from && item.date <= filters.to);
  if (filters.branch) list = list.filter((item) => item.branch === filters.branch);
  if (filters.type) list = list.filter((item) => item.type === filters.type);
  if (filters.nature) list = list.filter((item) => item.nature === filters.nature);
  return [...list].sort((a, b) => b.date.localeCompare(a.date));
}

export function createTransaction(db: DatabaseShape, input: CreateTransactionInput, userId: string): Transaction {
  const movement = db.movementTypes.find((item) => item.id === input.movementTypeId);
  if (!movement || !movement.active) throw new Error('Tipo de movimentação inválido');
  if (movement.direction !== 'both' && movement.direction !== input.type) {
    throw new Error('Este tipo não aceita essa direção (entrada/saída)');
  }
  const memberGuardianId = resolveGuardianId(db, input.memberId, input.memberGuardianId);
  const { paidAt, paymentStatus, ...data } = input;
  const tx: Transaction = {
    id: id(),
    ...data,
    memberGuardianId,
    paymentStatus: paymentStatus ?? 'paid',
    amount: roundMoney(input.amount),
    ...createdAudit(userId),
  };
  stampPaidAt(tx, movement.name, tx.paymentStatus, paidAt);
  if (!memberGuardianId) delete tx.memberGuardianId;
  db.transactions.push(tx);
  return tx;
}

export function updateTransaction(
  db: DatabaseShape,
  txId: string,
  input: PatchTransactionInput,
  userId: string,
): { tx: Transaction; shouldNotify: boolean } | null {
  const tx = db.transactions.find((item) => item.id === txId);
  if (!tx) return null;
  const {
    memberId,
    memberAccountId,
    memberGuardianId,
    projectId,
    amount,
    movementTypeId,
    type,
    notifyReceipt,
    paidAt,
    paymentStatus,
    ...rest
  } = input;
  const shouldNotify = Boolean(notifyReceipt) && paymentStatus === 'paid' && tx.paymentStatus !== 'paid';
  const becamePaid = paymentStatus === 'paid' && tx.paymentStatus !== 'paid';
  const nextType = type ?? tx.type;
  const nextMovementId = movementTypeId ?? tx.movementTypeId;
  const movement = db.movementTypes.find((item) => item.id === nextMovementId);
  if (!movement) throw new Error('Tipo de movimentação inválido');
  const sameKind = nextType === tx.type && nextMovementId === tx.movementTypeId;
  if (!sameKind) {
    if (!movement.active) throw new Error('Este tipo está inativo. Escolha outro tipo de movimentação.');
    if (movement.direction !== 'both' && movement.direction !== nextType) {
      throw new Error('Este tipo não aceita essa direção (entrada/saída). Troque o tipo ou a direção.');
    }
  }
  Object.assign(tx, rest, { type: nextType, movementTypeId: nextMovementId }, updatedAudit(userId));
  if (amount !== undefined) tx.amount = roundMoney(amount);
  if (paymentStatus !== undefined || paidAt !== undefined) {
    stampPaidAt(tx, movement.name, paymentStatus ?? tx.paymentStatus, paidAt === undefined ? tx.paidAt : paidAt);
  }
  if (becamePaid && tx.arrearsId && tx.arrearsYearMonth) {
    registerArrearsInstallmentPaid(db, tx.arrearsId, tx.arrearsYearMonth, userId, {
      source: 'separate',
      transactionId: tx.id,
      method: tx.method,
      paidAt: tx.paidAt ?? tx.date,
    });
  }
  // Mensalidade + acordo: se uma parte foi paga e a outra não (ou em datas diferentes), vira lançamentos únicos.
  if (paymentStatus !== undefined || paidAt !== undefined) {
    dissolveMensalidadeArrearsSplitIfSeparate(db, tx, userId);
  }
  if (memberId === null) delete tx.memberId;
  else if (memberId) tx.memberId = memberId;
  if (memberAccountId === null) delete tx.memberAccountId;
  else if (memberAccountId) tx.memberAccountId = memberAccountId;
  if (projectId === null) delete tx.projectId;
  else if (projectId) tx.projectId = projectId;
  if (memberId) learnPayerAccount(db, tx, userId);
  const nextMemberId = memberId === null ? undefined : (memberId ?? tx.memberId);
  if (memberGuardianId === null || !nextMemberId) {
    delete tx.memberGuardianId;
  } else if (memberGuardianId) {
    tx.memberGuardianId = resolveGuardianId(db, nextMemberId, memberGuardianId);
  } else if (tx.memberGuardianId) {
    const belongs = (db.memberGuardians ?? []).some(
      (item) => item.id === tx.memberGuardianId && item.memberId === nextMemberId,
    );
    if (!belongs) delete tx.memberGuardianId;
  }
  return { tx, shouldNotify };
}

/** Guarda o CPF do pagador do Pix no associado para identificar os próximos extratos automaticamente. */
export function learnPayerAccount(db: DatabaseShape, tx: Transaction, userId: string) {
  const payer = sicrediPayer(tx.description);
  if (!payer || !tx.memberId) return;
  const known = db.memberAccounts.some(
    (item) => item.memberId === tx.memberId && item.document.replace(/\D/g, '') === payer.document,
  );
  if (known) return;
  db.memberAccounts.push({
    id: id(),
    memberId: tx.memberId,
    holderName: payer.name,
    holderKind: 'other',
    relationship: 'Pagador do Pix',
    pixKey: '',
    bank: '',
    agency: '',
    accountNumber: '',
    document: payer.document,
    notes: 'Aprendido na conciliação do extrato',
    isPrimary: false,
    active: true,
    ...createdAudit(userId, 'integration'),
  });
}

export function deleteTransaction(db: DatabaseShape, txId: string) {
  const before = db.transactions.length;
  db.transactions = db.transactions.filter((item) => item.id !== txId);
  return db.transactions.length < before;
}
