import { allocationIndex, groupCashOf } from '../allocations/allocations';
import { CLUB_REMITTANCE_MOVEMENT_NAME } from '../club-remittance/club-remittance';
import { isSnackExpenseMovementName } from '../snack-fund/snack-fund';
import { isMensalidadeName } from '../statement/statement';
import { cashBalance } from '../reports/finance';
import type { BranchId, DatabaseShape, MensalidadeAllocation, Transaction, YouthBranchId } from '../shared/types';
import { BRANCH_LABELS, roundMoney } from '../shared/types';

/**
 * Para onde foi cada real do caixa, sem contar nada duas vezes.
 *
 * Cada lançamento pago vira uma ou mais "fatias", cada uma num único destino:
 * - ramo: caixinha das mensalidades dos jovens do ramo + tudo que foi lançado no ramo (receitas e saídas), exceto mensalidade;
 * - lanche: parte do lanche das mensalidades − saídas de Lanche/Alimentação do grupo;
 * - clube: taxa do clube das mensalidades − repasses ao Lindóia;
 * - grupo: saldo inicial do caixa + operacional/diluição/atraso/dívida das mensalidades + o resto do grupo;
 * - conferir: diferença entre recebido e tabela + mensalidade paga sem divisão (sem associado).
 * A soma dos destinos é sempre o saldo de caixa.
 */

export const YOUTH_LEDGER_BRANCHES: YouthBranchId[] = [
  'filhote',
  'lobinho',
  'escoteiro',
  'senior',
  'pioneiro',
  'flor-de-lis',
];

export type Bucket = YouthBranchId | 'grupo' | 'lanche' | 'clube' | 'conferir';

export type SliceKind = 'caixinha' | 'receita' | 'saida' | 'mensalidade' | 'diferenca';

export interface Slice {
  bucket: Bucket;
  kind: SliceKind;
  /** Entrada positiva, saída negativa. */
  amount: number;
  tx: Transaction;
  allocation?: MensalidadeAllocation;
}

const BUCKET_LABELS: Record<Bucket, string> = {
  ...(Object.fromEntries(YOUTH_LEDGER_BRANCHES.map((branch) => [branch, BRANCH_LABELS[branch]])) as Record<
    YouthBranchId,
    string
  >),
  grupo: 'Caixa do grupo',
  lanche: 'Fundo do lanche',
  clube: 'Taxa do clube a repassar',
  conferir: 'A conferir',
};

function isYouthBranch(branch: BranchId): branch is YouthBranchId {
  return branch !== 'grupo';
}

function movementName(db: DatabaseShape, tx: Transaction) {
  return db.movementTypes.find((item) => item.id === tx.movementTypeId)?.name ?? '';
}

/** Data do lançamento: a mesma do livro-caixa e do saldo de caixa, para os números baterem em qualquer corte. */
export function ledgerDate(tx: Transaction): string {
  return tx.date.slice(0, 10);
}

/** Fatias de um lançamento pago. */
export function slicesOf(db: DatabaseShape, tx: Transaction, allocations = allocationIndex(db)): Slice[] {
  if (tx.paymentStatus === 'pending') return [];
  const name = movementName(db, tx);
  const sign = tx.type === 'income' ? 1 : -1;
  const amount = roundMoney(sign * tx.amount);

  if (tx.type === 'income' && isMensalidadeName(name)) {
    const allocation = allocations.get(tx.id);
    if (!allocation) return [{ bucket: 'conferir', kind: 'mensalidade', amount, tx }];
    const slices: Slice[] = [
      { bucket: 'grupo', kind: 'mensalidade', amount: groupCashOf(allocation), tx, allocation },
      { bucket: allocation.memberBranch, kind: 'caixinha', amount: allocation.branch, tx, allocation },
      { bucket: 'lanche', kind: 'mensalidade', amount: allocation.snack, tx, allocation },
      { bucket: 'clube', kind: 'mensalidade', amount: allocation.club, tx, allocation },
      { bucket: 'conferir', kind: 'diferenca', amount: allocation.difference, tx, allocation },
    ];
    return slices.filter((slice) => slice.amount !== 0);
  }

  if (tx.type === 'expense' && name.toLowerCase() === CLUB_REMITTANCE_MOVEMENT_NAME.toLowerCase()) {
    return [{ bucket: 'clube', kind: 'saida', amount, tx }];
  }
  if (isYouthBranch(tx.branch)) {
    return [{ bucket: tx.branch, kind: tx.type === 'income' ? 'receita' : 'saida', amount, tx }];
  }
  if (tx.type === 'expense' && isSnackExpenseMovementName(name)) {
    return [{ bucket: 'lanche', kind: 'saida', amount, tx }];
  }
  return [{ bucket: 'grupo', kind: tx.type === 'income' ? 'receita' : 'saida', amount, tx }];
}

function allSlices(db: DatabaseShape, until?: string): Slice[] {
  const allocations = allocationIndex(db);
  const slices: Slice[] = [];
  for (const tx of db.transactions) {
    if (until && ledgerDate(tx) > until) continue;
    slices.push(...slicesOf(db, tx, allocations));
  }
  return slices;
}

export interface MoneyMapRow {
  bucket: Bucket;
  label: string;
  /** Saldo antes do período (no grupo, inclui o saldo inicial do caixa). */
  opening: number;
  income: number;
  expense: number;
  balance: number;
}

export interface MoneyMap {
  from: string | null;
  until: string | null;
  rows: MoneyMapRow[];
  total: number;
  /** Saldo de caixa do sistema na data (o mesmo do livro-caixa). */
  cashBalance: number;
}

const BUCKET_ORDER: Bucket[] = ['grupo', ...YOUTH_LEDGER_BRANCHES, 'lanche', 'clube', 'conferir'];

/**
 * Saldo de cada destino até a data (inclusive); a soma tem que dar o saldo de caixa.
 * Com `from`, entradas e saídas são só as do período e o que veio antes fica no saldo anterior.
 */
export function buildMoneyMap(db: DatabaseShape, until?: string, from?: string): MoneyMap {
  const rows = new Map<Bucket, MoneyMapRow>(
    BUCKET_ORDER.map((bucket) => [
      bucket,
      { bucket, label: BUCKET_LABELS[bucket], opening: 0, income: 0, expense: 0, balance: 0 },
    ]),
  );
  rows.get('grupo')!.opening = roundMoney(db.settings.openingBalance);
  for (const slice of allSlices(db, until)) {
    const row = rows.get(slice.bucket)!;
    if (from && ledgerDate(slice.tx) < from) row.opening = roundMoney(row.opening + slice.amount);
    else if (slice.amount >= 0) row.income = roundMoney(row.income + slice.amount);
    else row.expense = roundMoney(row.expense - slice.amount);
  }
  for (const row of rows.values()) row.balance = roundMoney(row.opening + row.income - row.expense);
  const list = [...rows.values()];
  return {
    from: from ?? null,
    until: until ?? null,
    rows: list,
    total: roundMoney(list.reduce((sum, row) => sum + row.balance, 0)),
    cashBalance: cashBalance(db, until),
  };
}

export interface BranchMonth {
  yearMonth: string;
  caixinha: number;
  income: number;
  expense: number;
  net: number;
  balance: number;
}

export interface BranchSource {
  kind: 'caixinha' | 'receita' | 'saida';
  movementTypeId: string | null;
  name: string;
  amount: number;
  count: number;
}

export interface BranchStatement {
  branch: YouthBranchId;
  label: string;
  months: BranchMonth[];
  totals: { caixinha: number; income: number; expense: number; balance: number };
  /** De onde veio e para onde foi, por tipo de movimentação (caixinha numa linha só). */
  sources: BranchSource[];
}

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [year, month] = first.split('-').map(Number);
  const [endYear, endMonth] = last.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function branchSlices(db: DatabaseShape, branch: YouthBranchId) {
  return allSlices(db).filter((slice) => slice.bucket === branch);
}

/** Extrato do ramo mês a mês desde o primeiro lançamento: caixinha + receitas próprias − saídas, com saldo acumulado. */
export function buildBranchStatement(db: DatabaseShape, branch: YouthBranchId): BranchStatement {
  const slices = branchSlices(db, branch);
  const byMonth = new Map<string, BranchMonth>();
  const sources = new Map<string, BranchSource>();

  for (const slice of slices) {
    const tx = slice.tx;
    const ym = ledgerDate(tx).slice(0, 7);
    const row = byMonth.get(ym) ?? { yearMonth: ym, caixinha: 0, income: 0, expense: 0, net: 0, balance: 0 };
    if (slice.kind === 'caixinha') row.caixinha = roundMoney(row.caixinha + slice.amount);
    else if (slice.amount >= 0) row.income = roundMoney(row.income + slice.amount);
    else row.expense = roundMoney(row.expense - slice.amount);
    byMonth.set(ym, row);

    const kind = slice.kind === 'caixinha' ? 'caixinha' : slice.amount >= 0 ? 'receita' : 'saida';
    const key = kind === 'caixinha' ? 'caixinha' : `${kind}:${tx.movementTypeId}`;
    const source = sources.get(key) ?? {
      kind,
      movementTypeId: kind === 'caixinha' ? null : tx.movementTypeId,
      name: kind === 'caixinha' ? 'Caixinha das mensalidades' : movementName(db, tx) || 'Sem tipo',
      amount: 0,
      count: 0,
    };
    source.amount = roundMoney(source.amount + Math.abs(slice.amount));
    source.count += 1;
    sources.set(key, source);
  }

  const keys = [...byMonth.keys()].sort();
  const months: BranchMonth[] = [];
  let balance = 0;
  if (keys.length) {
    for (const ym of monthsBetween(keys[0], keys[keys.length - 1])) {
      const row = byMonth.get(ym) ?? { yearMonth: ym, caixinha: 0, income: 0, expense: 0, net: 0, balance: 0 };
      row.net = roundMoney(row.caixinha + row.income - row.expense);
      balance = roundMoney(balance + row.net);
      row.balance = balance;
      months.push(row);
    }
  }

  const sum = (pick: (row: BranchMonth) => number) => roundMoney(months.reduce((acc, row) => acc + pick(row), 0));
  const kindOrder = { caixinha: 0, receita: 1, saida: 2 };
  return {
    branch,
    label: BRANCH_LABELS[branch],
    months,
    totals: {
      caixinha: sum((row) => row.caixinha),
      income: sum((row) => row.income),
      expense: sum((row) => row.expense),
      balance,
    },
    sources: [...sources.values()].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.amount - a.amount),
  };
}

export interface BranchLine {
  transactionId: string;
  date: string;
  kind: 'caixinha' | 'receita' | 'saida';
  movementTypeName: string;
  description: string;
  memberName?: string;
  amount: number;
  /** Na caixinha: valor pago e competência, para conferir com a divisão gravada. */
  paid?: number;
  dueDate?: string;
}

/** Lançamentos de um mês do extrato do ramo. */
export function buildBranchLines(db: DatabaseShape, branch: YouthBranchId, yearMonth: string): BranchLine[] {
  const members = new Map(db.members.map((item) => [item.id, item.name]));
  return branchSlices(db, branch)
    .filter((slice) => ledgerDate(slice.tx).startsWith(yearMonth))
    .map((slice) => {
      const tx = slice.tx;
      const caixinha = slice.kind === 'caixinha';
      return {
        transactionId: tx.id,
        date: ledgerDate(tx),
        kind: caixinha ? ('caixinha' as const) : slice.amount >= 0 ? ('receita' as const) : ('saida' as const),
        movementTypeName: movementName(db, tx),
        description: tx.description,
        memberName: tx.memberId ? members.get(tx.memberId) : undefined,
        amount: Math.abs(slice.amount),
        ...(caixinha ? { paid: roundMoney(tx.amount), dueDate: tx.date.slice(0, 10) } : {}),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}
