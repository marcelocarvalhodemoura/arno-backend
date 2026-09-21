import { fold } from "../shared/csv";
import type {
  BranchId,
  CashFlowMonth,
  CustomReportQuery,
  CustomReportRow,
  DashboardPayload,
  DatabaseShape,
  FinancialProject,
  FiscalLedgerLine,
  ProjectItem,
  Transaction,
} from "../shared/types";
import { BRANCH_LABELS, DASHBOARD_BRANCHES, monthKey, pad2, periodBounds, roundMoney } from "../shared/types";

export function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

export function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return roundMoney(items.reduce((acc, item) => acc + pick(item), 0));
}

export function isSettled(tx: Transaction): boolean {
  return tx.paymentStatus !== "pending";
}

export function cashBalance(db: DatabaseShape, until?: string): number {
  const txs = (until ? db.transactions.filter((t) => t.date <= until) : db.transactions).filter(isSettled);
  const net = sumBy(txs, (t) => (t.type === "income" ? t.amount : -t.amount));
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
    const [year, mo] = month.split("-");
    const prefix = `${year}-${mo}`;
    const txs = db.transactions.filter((t) => isSettled(t) && t.date.startsWith(prefix) && inRange(t.date, from, to));
    const income = sumBy(
      txs.filter((t) => t.type === "income"),
      (t) => t.amount,
    );
    const expense = sumBy(
      txs.filter((t) => t.type === "expense"),
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
      br[t.type] = roundMoney(br[t.type] + t.amount);
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

export function projectItemActuals(db: DatabaseShape, project: FinancialProject, item: ProjectItem) {
  const typeId = typeIdForItem(db, item);
  const txs = db.transactions.filter((tx) => {
    if (!isSettled(tx) || tx.projectId !== project.id) return false;
    if (typeId) return tx.movementTypeId === typeId;
    return fold(tx.description).includes(fold(item.description));
  });
  return {
    itemId: item.id,
    income: sumBy(
      txs.filter((tx) => tx.type === "income"),
      (tx) => tx.amount,
    ),
    expense: sumBy(
      txs.filter((tx) => tx.type === "expense"),
      (tx) => tx.amount,
    ),
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
      txs.filter((t) => t.type === "income"),
      (t) => t.amount,
    ),
    expense: sumBy(
      txs.filter((t) => t.type === "expense"),
      (t) => t.amount,
    ),
    byCategory: [...byType.entries()].map(([movementTypeId, v]) => ({
      category: typeName(db, movementTypeId),
      ...v,
    })),
    byItem: project ? project.items.map((item) => projectItemActuals(db, project, item)) : [],
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
    .filter((t) => {
      if (!isSettled(t)) return false;
      if (!inRange(t.date, query.from, query.to)) return false;
      if (query.branches.length && !query.branches.includes(t.branch)) return false;
      if (query.types.length && !query.types.includes(t.type)) return false;
      if (query.natures.length && !query.natures.includes(t.nature)) return false;
      if (query.movementTypeIds.length && !query.movementTypeIds.includes(t.movementTypeId)) {
        return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const buckets = new Map<string, CustomReportRow>();

  const keyOf = (t: Transaction): { key: string; label: string } => {
    switch (query.groupBy) {
      case "month": {
        const key = t.date.slice(0, 7);
        return { key, label: key };
      }
      case "branch":
        return { key: t.branch, label: BRANCH_LABELS[t.branch] };
      case "movementType":
        return { key: t.movementTypeId, label: typeName(db, t.movementTypeId) };
      case "nature":
        return {
          key: t.nature,
          label: t.nature === "fixed" ? "Fixa" : "Variável",
        };
      default:
        return { key: t.id, label: t.description };
    }
  };

  for (const t of txs) {
    const { key, label } = keyOf(t);
    const row = buckets.get(key) ?? {
      key,
      label,
      income: 0,
      expense: 0,
      net: 0,
      count: 0,
    };
    if (t.type === "income") row.income = roundMoney(row.income + t.amount);
    else row.expense = roundMoney(row.expense + t.amount);
    row.net = roundMoney(row.income - row.expense);
    row.count += 1;
    buckets.set(key, row);
  }

  const rows = [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const totals: CustomReportRow = {
    key: "total",
    label: "Total",
    income: sumBy(rows, (r) => r.income),
    expense: sumBy(rows, (r) => r.expense),
    net: 0,
    count: txs.length,
  };
  totals.net = roundMoney(totals.income - totals.expense);

  const opening = cashBalance(db, dayBefore(query.from));
  let running = opening;
  const ledger: FiscalLedgerLine[] = txs.map((t, index) => {
    const income = t.type === "income" ? t.amount : 0;
    const expense = t.type === "expense" ? t.amount : 0;
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
      createdByName: "",
      createdAt: t.createdAt,
      origin: t.origin,
      updatedAt: t.updatedAt,
    };
  });

  return { rows, transactions: txs, totals, ledger, opening, closing: running };
}

export function dashboard(db: DatabaseShape, year: number, month: number): DashboardPayload {
  const { from, to } = periodBounds(year, month);
  const opening = cashBalance(db, dayBefore(from));
  const periodTx = db.transactions.filter((t) => isSettled(t) && inRange(t.date, from, to));
  const income = sumBy(
    periodTx.filter((t) => t.type === "income"),
    (t) => t.amount,
  );
  const expense = sumBy(
    periodTx.filter((t) => t.type === "expense"),
    (t) => t.amount,
  );
  const membersInPeriod = db.members.filter((m) => m.joinedAt <= to);

  const byBranch = DASHBOARD_BRANCHES.map((branch) => {
    const txs = periodTx.filter((t) => t.branch === branch);
    return {
      branch,
      income: sumBy(
        txs.filter((t) => t.type === "income"),
        (t) => t.amount,
      ),
      expense: sumBy(
        txs.filter((t) => t.type === "expense"),
        (t) => t.amount,
      ),
      members: membersInPeriod.filter((m) => m.branch === branch).length,
    };
  });

  const chart = monthsBetween(from, to).map((key) => {
    const txs = periodTx.filter((t) => t.date.startsWith(key));
    const monthIncome = sumBy(
      txs.filter((t) => t.type === "income"),
      (t) => t.amount,
    );
    const monthExpense = sumBy(
      txs.filter((t) => t.type === "expense"),
      (t) => t.amount,
    );
    return {
      month: key,
      income: monthIncome,
      expense: monthExpense,
      balance: roundMoney(monthIncome - monthExpense),
    };
  });

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
    activeMembers: membersInPeriod.filter((m) => m.status === "active").length,
    byBranch,
    chart,
  };
}
