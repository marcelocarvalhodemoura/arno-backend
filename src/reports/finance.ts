import { fold } from '../shared/csv';
import { MENSALIDADE_BRANCH_SHARE } from '../mensalidades/fee-table';
import { isMensalidadeName } from '../statement/statement';
import type {
  BranchId,
  BudgetStatus,
  CashFlowMonth,
  CustomReportQuery,
  CustomReportRow,
  DashboardBudget,
  DashboardPayload,
  DatabaseShape,
  FinancialProject,
  FiscalLedgerLine,
  ProjectItem,
  Transaction,
} from '../shared/types';
import { BRANCH_LABELS, DASHBOARD_BRANCHES, monthKey, pad2, periodBounds, roundMoney } from '../shared/types';

export function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

export function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return roundMoney(items.reduce((acc, item) => acc + pick(item), 0));
}

export function isSettled(tx: Transaction): boolean {
  return tx.paymentStatus !== 'pending';
}

function isMensalidadeIncome(db: DatabaseShape, tx: Transaction): boolean {
  if (tx.type !== 'income') return false;
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return Boolean(movement && isMensalidadeName(movement.name));
}

/**
 * Valor do lançamento na visão por ramo.
 * Mensalidade de jovem: só a caixinha do ramo (R$ 8 do cartaz), não o valor integral.
 */
export function amountForBranchView(db: DatabaseShape, tx: Transaction): number {
  if (tx.branch === 'grupo') return tx.amount;
  if (!isMensalidadeIncome(db, tx)) return tx.amount;
  return roundMoney(Math.min(MENSALIDADE_BRANCH_SHARE, Math.abs(tx.amount)));
}

/** Caixinha do ramo só na síntese/agrupamento por ramo — relatório fiscal permanece integral. */
function usesBranchMensalidadeShare(query: Pick<CustomReportQuery, 'groupBy'>): boolean {
  return query.groupBy === 'branch';
}

function reportAmount(db: DatabaseShape, tx: Transaction, query: Pick<CustomReportQuery, 'groupBy'>): number {
  return usesBranchMensalidadeShare(query) ? amountForBranchView(db, tx) : tx.amount;
}

export function cashBalance(db: DatabaseShape, until?: string): number {
  const txs = (until ? db.transactions.filter((t) => t.date <= until) : db.transactions).filter(isSettled);
  const net = sumBy(txs, (t) => (t.type === 'income' ? t.amount : -t.amount));
  return roundMoney(db.settings.openingBalance + net);
}

function monthsBetween(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    keys.push(monthKey(cursor.getFullYear(), cursor.getMonth() + 1));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function matchesReportFilters(
  t: Transaction,
  query: Pick<CustomReportQuery, 'branches' | 'types' | 'natures' | 'movementTypeIds'>,
): boolean {
  if (query.branches.length && !query.branches.includes(t.branch)) return false;
  if (query.types.length && !query.types.includes(t.type)) return false;
  if (query.natures.length && !query.natures.includes(t.nature)) return false;
  if (query.movementTypeIds.length && !query.movementTypeIds.includes(t.movementTypeId)) {
    return false;
  }
  return true;
}

function hasPartitionFilters(
  query: Pick<CustomReportQuery, 'branches' | 'types' | 'natures' | 'movementTypeIds'>,
): boolean {
  return (
    query.branches.length > 0 || query.types.length > 0 || query.natures.length > 0 || query.movementTypeIds.length > 0
  );
}

/** Saldo de abertura do relatório — respeita os mesmos filtros da apuração. */
export function reportOpeningBalance(db: DatabaseShape, query: CustomReportQuery): number {
  const until = dayBefore(query.from);
  const prior = db.transactions.filter((t) => isSettled(t) && t.date <= until && matchesReportFilters(t, query));
  const net = sumBy(prior, (t) => {
    const amount = reportAmount(db, t, query);
    return t.type === 'income' ? amount : -amount;
  });
  // Saldo-caixa do grupo só no relatório integral.
  // Visão por ramo (caixinha) ou com filtro de partição: parte do zero + histórico do recorte.
  const base = hasPartitionFilters(query) || usesBranchMensalidadeShare(query) ? 0 : db.settings.openingBalance;
  return roundMoney(base + net);
}

function typeName(db: DatabaseShape, id: string): string {
  return db.movementTypes.find((t) => t.id === id)?.name ?? id;
}

export function cashFlow(
  db: DatabaseShape,
  from: string,
  to: string,
): { opening: number; months: CashFlowMonth[]; closing: number } {
  const opening = cashBalance(db, dayBefore(from));
  let running = opening;
  const months = monthsBetween(from, to).map((month) => {
    const [year, mo] = month.split('-');
    const prefix = `${year}-${mo}`;
    const txs = db.transactions.filter((t) => isSettled(t) && t.date.startsWith(prefix) && inRange(t.date, from, to));
    const income = sumBy(
      txs.filter((t) => t.type === 'income'),
      (t) => t.amount,
    );
    const expense = sumBy(
      txs.filter((t) => t.type === 'expense'),
      (t) => t.amount,
    );
    running = roundMoney(running + income - expense);

    const typeMap = new Map<string, { income: number; expense: number }>();
    const branchMap = new Map<BranchId, { income: number; expense: number }>();
    for (const t of txs) {
      const cat = typeMap.get(t.movementTypeId) ?? { income: 0, expense: 0 };
      cat[t.type] = roundMoney(cat[t.type] + t.amount);
      typeMap.set(t.movementTypeId, cat);
      const br = branchMap.get(t.branch) ?? { income: 0, expense: 0 };
      const branchAmount = amountForBranchView(db, t);
      br[t.type] = roundMoney(br[t.type] + branchAmount);
      branchMap.set(t.branch, br);
    }

    return {
      month,
      income,
      expense,
      net: roundMoney(income - expense),
      balance: running,
      byMovementType: [...typeMap.entries()].map(([movementTypeId, v]) => ({
        movementTypeId,
        name: typeName(db, movementTypeId),
        ...v,
      })),
      byBranch: [...branchMap.entries()].map(([branch, v]) => ({
        branch,
        ...v,
      })),
    };
  });

  return { opening, months, closing: running };
}

function typeIdForItem(db: DatabaseShape, item: ProjectItem) {
  if (item.movementTypeId) return item.movementTypeId;
  const key = fold(item.category);
  return db.movementTypes.find((type) => fold(type.name) === key)?.id;
}

function describes(item: ProjectItem, tx: Transaction): boolean {
  const key = fold(item.description);
  return Boolean(key) && fold(tx.description).includes(key);
}

/** Divide o valor entre os itens proporcionalmente ao previsto (igual se nada previsto); centavos no último. */
function splitByPlanned(amount: number, items: ProjectItem[]): number[] {
  const weights = items.map((item) => Math.max(0, item.planned || 0));
  const total = weights.reduce((acc, w) => acc + w, 0);
  const shares = items.map((_, i) => roundMoney(total > 0 ? (amount * weights[i]) / total : amount / items.length));
  shares[shares.length - 1] = roundMoney(amount - shares.slice(0, -1).reduce((acc, s) => acc + s, 0));
  return shares;
}

/**
 * Realizado por item da previsão. Cada lançamento entra uma única vez:
 * itens do mesmo tipo disputam pela descrição; sem desempate, rateio pelo previsto.
 */
export function projectItemActuals(db: DatabaseShape, project: FinancialProject) {
  const typed = project.items.map((item) => ({ item, typeId: typeIdForItem(db, item) }));
  const totals = new Map(project.items.map((item) => [item.id, { income: 0, expense: 0 }]));
  const txs = db.transactions.filter((tx) => isSettled(tx) && tx.projectId === project.id);

  for (const tx of txs) {
    const byType = typed.filter((row) => row.typeId && row.typeId === tx.movementTypeId).map((row) => row.item);
    const candidates = byType.length
      ? byType
      : typed.filter((row) => !row.typeId && describes(row.item, tx)).map((row) => row.item);
    if (!candidates.length) continue;
    const named = candidates.filter((item) => describes(item, tx));
    const targets = named.length ? named : candidates;
    const shares = splitByPlanned(tx.amount, targets);
    targets.forEach((item, i) => {
      const row = totals.get(item.id)!;
      row[tx.type] = roundMoney(row[tx.type] + shares[i]);
    });
  }

  return project.items.map((item) => ({ itemId: item.id, ...totals.get(item.id)! }));
}

/** Status da previsão: estourou, acima do ritmo do ano, ou no caminho. */
export function budgetStatus(planned: number, actual: number, paceMonth?: number | null): BudgetStatus {
  const safePlanned = Number.isFinite(planned) ? planned : 0;
  const safeActual = Number.isFinite(actual) ? actual : 0;
  if (safeActual > safePlanned && (safePlanned > 0 || safeActual > 0)) return 'over';
  if (paceMonth && paceMonth >= 1 && paceMonth <= 12 && safePlanned > 0) {
    const expected = safePlanned * (paceMonth / 12);
    if (safeActual > expected) return 'watch';
  }
  return 'ok';
}

function budgetSlice(planned: number, actual: number, paceMonth?: number | null) {
  const safePlanned = roundMoney(planned);
  const safeActual = roundMoney(actual);
  return {
    planned: safePlanned,
    actual: safeActual,
    remaining: roundMoney(safePlanned - safeActual),
    status: budgetStatus(safePlanned, safeActual, paceMonth),
  };
}

/** Consolidado anual da previsão (projetos do ano × saídas liquidadas com projectId). */
export function yearBudget(db: DatabaseShape, year: number, paceMonth?: number | null): DashboardBudget {
  const yearFrom = `${year}-01-01`;
  const yearTo = `${year}-12-31`;
  const projects = db.projects.filter((project) => project.year === year);
  const projectIds = new Set(projects.map((project) => project.id));
  const yearExpenses = db.transactions.filter(
    (tx) =>
      isSettled(tx) &&
      tx.type === 'expense' &&
      tx.projectId &&
      projectIds.has(tx.projectId) &&
      inRange(tx.date, yearFrom, yearTo),
  );

  const byBranch = DASHBOARD_BRANCHES.map((branch) => {
    const branchProjects = projects.filter((project) => project.branch === branch);
    const planned = sumBy(
      branchProjects.flatMap((project) => project.items),
      (item) => item.planned,
    );
    const ids = new Set(branchProjects.map((project) => project.id));
    const actual = sumBy(
      yearExpenses.filter((tx) => tx.projectId && ids.has(tx.projectId)),
      (tx) => tx.amount,
    );
    return { branch, ...budgetSlice(planned, actual, paceMonth) };
  }).filter((row) => row.planned > 0 || row.actual > 0);

  const typePlanned = new Map<string, { name: string; planned: number }>();
  for (const project of projects) {
    for (const item of project.items) {
      const typeId =
        item.movementTypeId || db.movementTypes.find((type) => fold(type.name) === fold(item.category))?.id || '';
      if (!typeId) continue;
      const name = typeName(db, typeId);
      const current = typePlanned.get(typeId) ?? { name, planned: 0 };
      current.planned = roundMoney(current.planned + item.planned);
      typePlanned.set(typeId, current);
    }
  }

  const byMovementType = [...typePlanned.entries()]
    .map(([movementTypeId, row]) => {
      const actual = sumBy(
        yearExpenses.filter((tx) => tx.movementTypeId === movementTypeId),
        (tx) => tx.amount,
      );
      return {
        movementTypeId,
        name: row.name,
        ...budgetSlice(row.planned, actual, paceMonth),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const plannedExpense = sumBy(
    projects.flatMap((project) => project.items),
    (item) => item.planned,
  );
  const actualExpense = sumBy(yearExpenses, (tx) => tx.amount);
  const remaining = roundMoney(plannedExpense - actualExpense);
  const pctUsed = plannedExpense > 0 ? Math.min(999, Math.round((actualExpense / plannedExpense) * 100)) : 0;

  return {
    plannedExpense: roundMoney(plannedExpense),
    actualExpense: roundMoney(actualExpense),
    remaining,
    pctUsed,
    byBranch,
    byMovementType,
  };
}

export function projectActuals(db: DatabaseShape, projectId: string) {
  const project = db.projects.find((item) => item.id === projectId);
  const txs = db.transactions.filter((t) => isSettled(t) && t.projectId === projectId);
  const byType = new Map<string, { income: number; expense: number }>();
  for (const t of txs) {
    const row = byType.get(t.movementTypeId) ?? { income: 0, expense: 0 };
    row[t.type] = roundMoney(row[t.type] + t.amount);
    byType.set(t.movementTypeId, row);
  }
  return {
    income: sumBy(
      txs.filter((t) => t.type === 'income'),
      (t) => t.amount,
    ),
    expense: sumBy(
      txs.filter((t) => t.type === 'expense'),
      (t) => t.amount,
    ),
    byCategory: [...byType.entries()].map(([movementTypeId, v]) => ({
      category: typeName(db, movementTypeId),
      ...v,
    })),
    byItem: project ? projectItemActuals(db, project) : [],
  };
}

export function customReport(
  db: DatabaseShape,
  query: CustomReportQuery,
): {
  rows: CustomReportRow[];
  transactions: Transaction[];
  totals: CustomReportRow;
  ledger: FiscalLedgerLine[];
  opening: number;
  closing: number;
} {
  const txs = db.transactions
    .filter((t) => isSettled(t) && inRange(t.date, query.from, query.to) && matchesReportFilters(t, query))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const buckets = new Map<string, CustomReportRow>();

  const keyOf = (t: Transaction): { key: string; label: string } => {
    switch (query.groupBy) {
      case 'month': {
        const key = t.date.slice(0, 7);
        return { key, label: key };
      }
      case 'branch':
        return { key: t.branch, label: BRANCH_LABELS[t.branch] };
      case 'movementType':
        return { key: t.movementTypeId, label: typeName(db, t.movementTypeId) };
      case 'nature':
        return {
          key: t.nature,
          label: t.nature === 'fixed' ? 'Fixa' : 'Variável',
        };
      case 'account': {
        const account = t.memberAccountId ? db.memberAccounts.find((a) => a.id === t.memberAccountId) : undefined;
        if (account) {
          return { key: account.id, label: account.holderName };
        }
        return { key: 'sem-conta', label: 'Sem conta vinculada' };
      }
      case 'member': {
        const member = t.memberId ? db.members.find((m) => m.id === t.memberId) : undefined;
        return member ? { key: member.id, label: member.name } : { key: 'sem-associado', label: 'Sem associado' };
      }
      case 'method': {
        const labels: Record<string, string> = {
          pix: 'Pix',
          transfer: 'Transferência',
          cash: 'Dinheiro',
          card: 'Cartão',
          other: 'Outro',
        };
        return { key: t.method, label: labels[t.method] ?? t.method };
      }
      default:
        return { key: t.id, label: t.description };
    }
  };

  for (const t of txs) {
    const { key, label } = keyOf(t);
    const amount = reportAmount(db, t, query);
    const row = buckets.get(key) ?? {
      key,
      label,
      income: 0,
      expense: 0,
      net: 0,
      count: 0,
    };
    if (t.type === 'income') row.income = roundMoney(row.income + amount);
    else row.expense = roundMoney(row.expense + amount);
    row.net = roundMoney(row.income - row.expense);
    row.count += 1;
    buckets.set(key, row);
  }

  const rows = [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  const totals: CustomReportRow = {
    key: 'total',
    label: 'Total',
    income: sumBy(rows, (r) => r.income),
    expense: sumBy(rows, (r) => r.expense),
    net: 0,
    count: txs.length,
  };
  totals.net = roundMoney(totals.income - totals.expense);

  const opening = reportOpeningBalance(db, query);
  let running = opening;
  const ledger: FiscalLedgerLine[] = txs.map((t, index) => {
    const amount = reportAmount(db, t, query);
    const income = t.type === 'income' ? amount : 0;
    const expense = t.type === 'expense' ? amount : 0;
    running = roundMoney(running + income - expense);
    const member = t.memberId ? db.members.find((m) => m.id === t.memberId) : undefined;
    const account = t.memberAccountId ? db.memberAccounts.find((a) => a.id === t.memberAccountId) : undefined;
    const guardian = t.memberGuardianId
      ? (db.memberGuardians ?? []).find((item) => item.id === t.memberGuardianId)
      : undefined;
    return {
      seq: index + 1,
      id: t.id,
      date: t.date,
      type: t.type,
      nature: t.nature,
      movementType: typeName(db, t.movementTypeId),
      branch: t.branch,
      memberName: member?.name,
      guardianName: guardian?.name,
      accountHolder: account?.holderName,
      description: t.description,
      income,
      expense,
      balance: running,
      createdByName: '',
      createdAt: t.createdAt,
      origin: t.origin,
      importSource: t.importSource,
      updatedAt: t.updatedAt,
    };
  });

  return { rows, transactions: txs, totals, ledger, opening, closing: running };
}

/**
 * Ritmo do calendário para o status da previsão (modo ano completo).
 * Ano encerrado: 12 meses · ano corrente: mês de hoje · ano futuro: sem ritmo (só ok/over).
 */
export function budgetPaceMonth(year: number, today = new Date()): number | null {
  const current = today.getFullYear();
  if (year < current) return 12;
  if (year > current) return null;
  return today.getMonth() + 1;
}

export function dashboard(db: DatabaseShape, year: number, month: number): DashboardPayload {
  const { from, to } = periodBounds(year, month);
  const opening = cashBalance(db, dayBefore(from));
  const periodTx = db.transactions.filter((t) => isSettled(t) && inRange(t.date, from, to));
  const income = sumBy(
    periodTx.filter((t) => t.type === 'income'),
    (t) => t.amount,
  );
  const expense = sumBy(
    periodTx.filter((t) => t.type === 'expense'),
    (t) => t.amount,
  );
  const membersInPeriod = db.members.filter((m) => m.joinedAt <= to);

  const byBranch = DASHBOARD_BRANCHES.map((branch) => {
    const txs = periodTx.filter((t) => t.branch === branch);
    return {
      branch,
      income: sumBy(
        txs.filter((t) => t.type === 'income'),
        (t) => amountForBranchView(db, t),
      ),
      expense: sumBy(
        txs.filter((t) => t.type === 'expense'),
        (t) => amountForBranchView(db, t),
      ),
      members: membersInPeriod.filter((m) => m.branch === branch).length,
    };
  });

  const chart = monthsBetween(from, to).map((key) => {
    const txs = periodTx.filter((t) => t.date.startsWith(key));
    const monthIncome = sumBy(
      txs.filter((t) => t.type === 'income'),
      (t) => t.amount,
    );
    const monthExpense = sumBy(
      txs.filter((t) => t.type === 'expense'),
      (t) => t.amount,
    );
    return {
      month: key,
      income: monthIncome,
      expense: monthExpense,
      balance: roundMoney(monthIncome - monthExpense),
    };
  });

  const paceMonth = month === 0 ? budgetPaceMonth(year) : null;

  return {
    year,
    month,
    from,
    to,
    opening,
    income,
    expense,
    current: roundMoney(opening + income - expense),
    members: membersInPeriod.length,
    activeMembers: membersInPeriod.filter((m) => m.status === 'active').length,
    byBranch,
    chart,
    budget: yearBudget(db, year, paceMonth),
  };
}
