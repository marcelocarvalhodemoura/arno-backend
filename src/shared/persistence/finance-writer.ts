import type { Prisma } from '@prisma/client';
import { stableStringify } from '../../ledger/governance';

/** Tabelas do financeiro na ordem das chaves estrangeiras: quem é referenciado vem antes. */
export const FINANCE_TABLES = [
  'movementType',
  'fee',
  'member',
  'memberSibling',
  'memberGuardian',
  'memberAccount',
  'memberArrears',
  'project',
  'projectItem',
  'transaction',
  'transactionTrash',
  'monthClosing',
  'feeSchedulePeriod',
  'settings',
] as const;

export type FinanceTable = (typeof FINANCE_TABLES)[number];
type Row = Record<string, unknown>;
export type FinanceRows = Record<FinanceTable, Row[]>;
export type FinanceChanges = Record<FinanceTable, { insert: Row[]; update: Row[]; remove: string[] }>;

/** Acima disto, uma gravação que apaga mais da metade de uma tabela é tratada como bug e recusada. */
const MASS_DELETE_MIN_ROWS = 20;

export function emptyRows(): FinanceRows {
  return Object.fromEntries(FINANCE_TABLES.map((table) => [table, []])) as unknown as FinanceRows;
}

function keyOf(table: FinanceTable, row: Row): string {
  if (table === 'monthClosing') return String(row.yearMonth);
  if (table === 'settings') return 'settings';
  return String(row.id);
}

/** O que mudou entre o financeiro lido e o financeiro depois da operação, tabela por tabela. */
export function diffFinanceRows(before: FinanceRows, after: FinanceRows): FinanceChanges {
  const changes = {} as FinanceChanges;
  for (const table of FINANCE_TABLES) {
    const previous = new Map(before[table].map((row) => [keyOf(table, row), row]));
    const next = new Map(after[table].map((row) => [keyOf(table, row), row]));
    const insert: Row[] = [];
    const update: Row[] = [];
    for (const [key, row] of next) {
      const old = previous.get(key);
      if (!old) insert.push(row);
      else if (stableStringify(old) !== stableStringify(row)) update.push(row);
    }
    const remove = [...previous.keys()].filter((key) => !next.has(key));
    changes[table] = { insert, update, remove };
  }
  return changes;
}

/**
 * Proteção contra bug: uma operação comum nunca apaga mais da metade de uma tabela. Antes, com TRUNCATE,
 * um array esvaziado por engano apagava a tabela inteira sem aviso.
 */
export function assertNoMassDelete(before: FinanceRows, changes: FinanceChanges) {
  for (const table of FINANCE_TABLES) {
    const removed = changes[table].remove.length;
    if (removed > MASS_DELETE_MIN_ROWS && removed > before[table].length / 2) {
      throw new Error(
        `Gravação recusada: apagaria ${removed} de ${before[table].length} linhas de ${table}. Isso indica um erro no código.`,
      );
    }
  }
}

export function countChanges(changes: FinanceChanges): number {
  return FINANCE_TABLES.reduce(
    (sum, table) => sum + changes[table].insert.length + changes[table].update.length + changes[table].remove.length,
    0,
  );
}

type Delegate = {
  createMany(args: { data: Row[] }): Promise<unknown>;
  update(args: { where: Row; data: Row }): Promise<unknown>;
  deleteMany(args: { where: Row }): Promise<unknown>;
  updateMany(args: { data: Row }): Promise<unknown>;
  create(args: { data: Row }): Promise<unknown>;
};

/**
 * Grava só o que mudou. Ordem: apaga (filhas antes das mães), insere e atualiza (mães antes das filhas).
 * Apagar antes de inserir libera chaves únicas reaproveitadas (ex.: id externo de um Pix reimportado).
 */
export async function applyFinanceChanges(client: Prisma.TransactionClient, changes: FinanceChanges) {
  const delegate = (table: FinanceTable) => (client as unknown as Record<FinanceTable, Delegate>)[table];

  for (const table of [...FINANCE_TABLES].reverse()) {
    const { remove } = changes[table];
    if (!remove.length || table === 'settings') continue;
    const field = table === 'monthClosing' ? 'yearMonth' : 'id';
    await delegate(table).deleteMany({ where: { [field]: { in: remove } } });
  }

  for (const table of FINANCE_TABLES) {
    const { insert, update } = changes[table];
    if (table === 'settings') {
      if (insert.length) await delegate(table).create({ data: insert[0] });
      else if (update.length) await delegate(table).updateMany({ data: update[0] });
      continue;
    }
    if (insert.length) await delegate(table).createMany({ data: insert });
    for (const row of update) {
      const field = table === 'monthClosing' ? 'yearMonth' : 'id';
      const { [field]: key, ...data } = row;
      await delegate(table).update({ where: { [field]: key }, data });
    }
  }
}
