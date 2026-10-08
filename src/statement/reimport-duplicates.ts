import { matchesBankRow } from './ingest';
import { isUnidentifiedName } from './statement';
import type { DatabaseShape, Transaction } from '../shared/types';

/** Importações separadas por mais que isso são sessões diferentes (o mesmo lote grava tudo junto). */
const SAME_IMPORT_MS = 60_000;

export type ReimportDuplicate = {
  /** Lançamento conciliado/editado que fica. */
  keep: Transaction;
  /** Crédito "A identificar" que uma reimportação criou de novo. */
  copy: Transaction;
};

/** Linha do extrato que gerou a cópia: a gravada na importação ou, sem ela, como está (ainda não foi editada). */
function bankLineOf(tx: Transaction) {
  return {
    date: tx.sourceDate ?? tx.date,
    type: tx.type,
    description: tx.sourceDescription ?? tx.description,
    amount: tx.sourceAmount ?? tx.amount,
    externalId: tx.externalId,
  };
}

/**
 * Pares criados pela reimportação antes da correção: o mesmo Pix já existia conciliado ou editado
 * (data no vencimento, descrição reescrita) e a importação seguinte criou outro "A identificar".
 * Só lista; nada é apagado aqui.
 *
 * Regras para não confundir com dois Pix iguais de verdade:
 * - a cópia ainda está "A identificar", sem associado e fora de rateio;
 * - quem fica foi criado antes, em outra sessão de importação, e não está "A identificar";
 * - cada lançamento entra em no máximo um par.
 */
export function findReimportDuplicates(db: DatabaseShape, range?: { from?: string; to?: string }): ReimportDuplicate[] {
  const identifyIds = new Set(db.movementTypes.filter((item) => isUnidentifiedName(item.name)).map((item) => item.id));
  const inRange = (tx: Transaction) => {
    const date = tx.sourceDate ?? tx.date;
    return (!range?.from || date >= range.from) && (!range?.to || date <= range.to);
  };
  const copies = db.transactions
    .filter(
      (tx) =>
        identifyIds.has(tx.movementTypeId) &&
        !tx.memberId &&
        !tx.splitGroupId &&
        (tx.paymentStatus ?? 'paid') === 'paid' &&
        inRange(tx),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const used = new Set<string>();
  const pairs: ReimportDuplicate[] = [];

  for (const copy of copies) {
    if (used.has(copy.id)) continue;
    const line = bankLineOf(copy);
    const created = Date.parse(copy.createdAt);
    const keep = db.transactions
      .filter(
        (tx) =>
          tx.id !== copy.id &&
          !used.has(tx.id) &&
          !identifyIds.has(tx.movementTypeId) &&
          (!tx.splitGroupId || tx.splitIndex === 1) &&
          created - Date.parse(tx.createdAt) > SAME_IMPORT_MS &&
          matchesBankRow(db, tx, line),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!keep) continue;
    used.add(copy.id);
    used.add(keep.id);
    pairs.push({ keep, copy });
  }
  return pairs;
}
