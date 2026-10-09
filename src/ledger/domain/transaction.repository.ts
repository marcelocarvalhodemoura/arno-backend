import type { DatabaseShape, Transaction, TrashedTransaction } from '../../shared/types';

/** O que as regras do lançamento precisam consultar além do próprio lançamento. */
export type LedgerContextRefs = {
  movementTypeIds?: (string | undefined)[];
  memberIds?: (string | undefined)[];
  memberAccountIds?: (string | undefined)[];
  memberGuardianIds?: (string | undefined)[];
  projectIds?: (string | undefined)[];
  /** Responsáveis destes associados (para validar o vínculo responsável ↔ associado). */
  guardiansOfMemberIds?: (string | undefined)[];
};

/**
 * Lançamentos do caixa. Toda gravação respeita o fechamento de mês e registra o histórico;
 * nenhuma regrava o financeiro inteiro.
 */
export interface TransactionRepository {
  findById(id: string): Promise<Transaction | null>;
  findTrashed(trashId: string): Promise<TrashedTransaction | null>;
  /**
   * Recorte do financeiro com só o que as regras precisam (tipos, associados, responsáveis...).
   * Permite reaproveitar as funções de domínio que recebem um `DatabaseShape` sem ler o banco inteiro.
   */
  loadContext(refs: LedgerContextRefs): Promise<DatabaseShape>;
  add(tx: Transaction): Promise<void>;
  save(tx: Transaction): Promise<void>;
  moveToTrash(tx: Transaction, userId: string, now?: Date): Promise<TrashedTransaction>;
  restoreFromTrash(entry: TrashedTransaction, tx: Transaction): Promise<void>;
  /** Apaga da lixeira o que foi excluído há mais de `days` dias. Devolve quantos saíram. */
  purgeTrash(now: Date, days: number): Promise<number>;
}

export const TRANSACTION_REPOSITORY = Symbol('TransactionRepository');
