import { planDuplicateRemovals } from '../statement/cleanup-duplicates';
import { isUnidentifiedName } from '../statement/statement';
import type { DatabaseShape, Transaction, TrashedTransaction } from '../shared/types';
import { trashTransaction } from './governance';

export function duplicateKey(ids: string[]): string {
  return `dup:${[...ids].sort().join(',')}`;
}

/** Pares (ou grupos) com mesmo dia, valor, documento e histórico. Só sugere; quem decide é a tesouraria. */
export function findDuplicateGroups(db: DatabaseShape, dismissed: Set<string>) {
  const identifyIds = new Set(db.movementTypes.filter((item) => isUnidentifiedName(item.name)).map((item) => item.id));
  const rows = db.transactions.map((tx) => ({
    id: tx.id,
    date: new Date(`${tx.date.slice(0, 10)}T00:00:00Z`),
    type: tx.type,
    description: tx.description,
    amount: tx.amount,
    origin: tx.origin,
    memberId: tx.memberId ?? null,
    externalId: tx.externalId ?? null,
    splitGroupId: tx.splitGroupId ?? null,
    splitIndex: tx.splitIndex ?? null,
    splitTotal: tx.splitTotal ?? null,
    movementTypeId: tx.movementTypeId,
    createdAt: new Date(tx.createdAt),
  }));
  const byId = new Map(db.transactions.map((tx) => [tx.id, tx]));
  const view = (tx: Transaction) => ({
    id: tx.id,
    date: tx.date,
    paidAt: tx.paidAt ?? null,
    description: tx.description,
    amount: tx.splitTotal ?? tx.amount,
    type: tx.type,
    origin: tx.origin,
    importSource: tx.importSource ?? null,
    paymentStatus: tx.paymentStatus,
    movementTypeName: db.movementTypes.find((item) => item.id === tx.movementTypeId)?.name ?? null,
    memberName: db.members.find((item) => item.id === tx.memberId)?.name ?? null,
    split: Boolean(tx.splitGroupId),
    createdAt: tx.createdAt,
  });
  return planDuplicateRemovals(rows, identifyIds)
    .map((plan) => ({ ...plan, key: duplicateKey([plan.keepId, ...plan.dropIds]) }))
    .filter((plan) => !dismissed.has(plan.key))
    .map((plan) => ({
      key: plan.key,
      keep: view(byId.get(plan.keepId)!),
      drop: plan.dropIds.map((txId) => view(byId.get(txId)!)),
    }));
}

/** Manda as cópias para a lixeira. A cópia nunca pode ser parte de rateio. */
export function resolveDuplicate(db: DatabaseShape, keepId: string, dropIds: string[], userId: string) {
  if (!db.transactions.some((tx) => tx.id === keepId)) throw new Error('Lançamento mantido não encontrado');
  const trashed: TrashedTransaction[] = [];
  for (const txId of dropIds) {
    if (txId === keepId) continue;
    const tx = db.transactions.find((item) => item.id === txId);
    if (!tx) continue;
    if (tx.splitGroupId) throw new Error('Partes de rateio não são excluídas por aqui; altere o rateio');
    const entry = trashTransaction(db, txId, userId);
    if (entry) trashed.push(entry);
  }
  return trashed;
}
