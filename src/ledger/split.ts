import { createdAudit, updatedAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { DatabaseShape, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';

export type SplitPart = {
  amount: number;
  movementTypeId: string;
  description: string;
  projectId?: string | null;
  memberId?: string | null;
};

/**
 * Se o lançamento já está rateado, remove as outras partes e restaura o valor original na primeira parte.
 * Devolve o lançamento “pai” pronto para um novo rateio.
 */
function consolidateSplitGroup(db: DatabaseShape, txId: string): Transaction {
  const seed = db.transactions.find((item) => item.id === txId);
  if (!seed) throw new Error('Lançamento não encontrado');
  if (!seed.splitGroupId) return seed;

  const groupId = seed.splitGroupId;
  const peers = db.transactions.filter((item) => item.splitGroupId === groupId);
  const primary = peers.find((item) => item.splitIndex === 1) ?? peers.find((item) => item.id === txId) ?? peers[0];
  if (!primary) throw new Error('Lançamento não encontrado');

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

export function splitTransaction(db: DatabaseShape, txId: string, parts: SplitPart[], userId: string): Transaction[] {
  const tx = consolidateSplitGroup(db, txId);
  if (parts.length < 2) throw new Error('Informe pelo menos duas partes para o rateio');
  const amounts = parts.map((part) => roundMoney(part.amount));
  if (amounts.some((amount) => !(amount > 0))) throw new Error('Cada parte precisa ter valor maior que zero');
  const originalAmount = roundMoney(tx.amount);
  const total = roundMoney(amounts.reduce((sum, amount) => sum + amount, 0));
  if (total !== originalAmount) {
    throw new Error('A soma das partes precisa ser igual ao valor do lançamento');
  }
  for (const part of parts) {
    if (part.memberId) {
      const member = db.members.find((item) => item.id === part.memberId);
      if (!member) throw new Error('Associado inválido no rateio');
    }
  }

  const splitGroupId = id();
  const splitCount = parts.length;
  const created: Transaction[] = [];

  for (const [index, part] of parts.entries()) {
    const movement = db.movementTypes.find((item) => item.id === part.movementTypeId);
    if (!movement) throw new Error('Tipo de movimentação inválido no rateio');
    if (movement.direction !== 'both' && movement.direction !== tx.type) {
      throw new Error(`O tipo “${movement.name}” não aceita ${tx.type === 'income' ? 'entrada' : 'saída'}`);
    }
    const description = part.description.trim();
    if (description.length < 2) throw new Error('Informe a descrição de cada parte');
    const splitIndex = index + 1;
    if (index === 0) {
      tx.amount = amounts[index];
      tx.movementTypeId = part.movementTypeId;
      tx.description = description;
      tx.splitGroupId = splitGroupId;
      tx.splitTotal = originalAmount;
      tx.splitIndex = splitIndex;
      tx.splitCount = splitCount;
      if (part.projectId === null) delete tx.projectId;
      else if (part.projectId) tx.projectId = part.projectId;
      if (part.memberId === null) delete tx.memberId;
      else if (part.memberId) tx.memberId = part.memberId;
      Object.assign(tx, updatedAudit(userId));
      created.push(tx);
      continue;
    }
    const copy: Transaction = {
      ...tx,
      id: id(),
      amount: amounts[index],
      movementTypeId: part.movementTypeId,
      description,
      notes: tx.notes,
      externalId: tx.externalId ? `${tx.externalId}:${index + 1}` : undefined,
      splitGroupId,
      splitTotal: originalAmount,
      splitIndex,
      splitCount,
      ...createdAudit(userId, tx.origin),
    };
    if (part.projectId === null) delete copy.projectId;
    else if (part.projectId) copy.projectId = part.projectId;
    if (part.memberId === null) delete copy.memberId;
    else if (part.memberId) copy.memberId = part.memberId;
    else delete copy.memberId;
    delete copy.updatedAt;
    delete copy.updatedBy;
    db.transactions.push(copy);
    created.push(copy);
  }
  return created;
}
