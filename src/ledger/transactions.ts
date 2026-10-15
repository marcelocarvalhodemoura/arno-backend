import { createdAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { BranchId, DatabaseShape, Transaction } from '../shared/types';
import type { CreateTransactionInput, PatchTransactionInput } from '../shared/http/schemas';
import { resolveGuardianId } from '../members/members';
import { sicrediPayer } from '../statement/statement';
import { domainEvents } from '../shared/domain/domain-events';
import { LedgerEntry, stampPaidAt } from './domain/ledger-entry';

export { stampPaidAt };

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
  const { paidAt, paymentStatus, memberGuardianId: guardianInput, ...fields } = input;
  const entry = LedgerEntry.open(fields, movement, { status: paymentStatus, paidAt }, userId);
  const memberGuardianId = resolveGuardianId(db, input.memberId, guardianInput);
  if (memberGuardianId) entry.tx.memberGuardianId = memberGuardianId;
  db.transactions.push(entry.tx);
  return entry.tx;
}

export function updateTransaction(
  db: DatabaseShape,
  txId: string,
  input: PatchTransactionInput,
  userId: string,
): { tx: Transaction; shouldNotify: boolean } | null {
  const tx = db.transactions.find((item) => item.id === txId);
  if (!tx) return null;
  const entry = LedgerEntry.of(tx);
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
  const shouldNotify = Boolean(notifyReceipt) && paymentStatus === 'paid' && !entry.isPaid;
  const movement = db.movementTypes.find((item) => item.id === (movementTypeId ?? tx.movementTypeId));
  entry.changeKind(type ?? tx.type, movement);
  Object.assign(tx, rest);
  entry.touch(userId);
  if (amount !== undefined) entry.changeAmount(amount);
  if (paymentStatus !== undefined || paidAt !== undefined) {
    entry.changePayment(
      movement!,
      paymentStatus ?? tx.paymentStatus,
      paidAt === undefined ? tx.paidAt : paidAt,
      userId,
    );
  }
  entry.assign('memberId', memberId);
  entry.assign('memberAccountId', memberAccountId);
  entry.assign('projectId', projectId);
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
  // Acordo de atrasados e rateio mensalidade + acordo reagem aos eventos de pagamento (arrears/arrears.events.ts).
  domainEvents.publish(entry.pullEvents(), db);
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
