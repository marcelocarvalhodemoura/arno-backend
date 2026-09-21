import { createdAudit, updatedAudit } from "../shared/audit";
import { id } from "../shared/id";
import type { DatabaseShape, Transaction } from "../shared/types";
import { roundMoney } from "../shared/types";

export type SplitPart = {
  amount: number;
  movementTypeId: string;
  description: string;
  projectId?: string | null;
  memberId?: string | null;
};

export function splitTransaction(db: DatabaseShape, txId: string, parts: SplitPart[], userId: string): Transaction[] {
  const tx = db.transactions.find((item) => item.id === txId);
  if (!tx) throw new Error("Lançamento não encontrado");
  if (parts.length < 2) throw new Error("Informe pelo menos duas partes para o rateio");
  const amounts = parts.map((part) => roundMoney(part.amount));
  if (amounts.some((amount) => !(amount > 0))) throw new Error("Cada parte precisa ter valor maior que zero");
  const total = roundMoney(amounts.reduce((sum, amount) => sum + amount, 0));
  if (total !== roundMoney(tx.amount)) {
    throw new Error("A soma das partes precisa ser igual ao valor do lançamento");
  }
  const created: Transaction[] = [];
  for (const [index, part] of parts.entries()) {
    const movement = db.movementTypes.find((item) => item.id === part.movementTypeId);
    if (!movement) throw new Error("Tipo de movimentação inválido no rateio");
    if (movement.direction !== "both" && movement.direction !== tx.type) {
      throw new Error(`O tipo “${movement.name}” não aceita ${tx.type === "income" ? "entrada" : "saída"}`);
    }
    const description = part.description.trim();
    if (description.length < 2) throw new Error("Informe a descrição de cada parte");
    if (index === 0) {
      tx.amount = amounts[index];
      tx.movementTypeId = part.movementTypeId;
      tx.description = description;
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
      ...createdAudit(userId, tx.origin),
    };
    if (part.projectId === null) delete copy.projectId;
    else if (part.projectId) copy.projectId = part.projectId;
    if (part.memberId === null) delete copy.memberId;
    else if (part.memberId) copy.memberId = part.memberId;
    delete copy.updatedAt;
    delete copy.updatedBy;
    db.transactions.push(copy);
    created.push(copy);
  }
  return created;
}
