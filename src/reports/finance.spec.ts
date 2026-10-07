import {
  amountForBranchView,
  budgetPaceMonth,
  budgetStatus,
  cashBalance,
  cashFlow,
  customReport,
  dashboard,
  inRange,
  projectActuals,
  sumBy,
  yearBudget,
} from './finance';
import type { DatabaseShape, MovementType, Transaction } from '../shared/types';

function movement(partial: Partial<MovementType> & Pick<MovementType, 'id' | 'name' | 'direction'>): MovementType {
  return {
    description: '',
    pixKey: '',
    branch: 'grupo',
    active: true,
    origin: 'integration',
    createdAt: '2026-01-01T12:00:00.000Z',
    ...partial,
  };
}

function tx(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'type' | 'amount'>): Transaction {
  return {
    nature: 'variable',
    movementTypeId: 'mt-doacao',
    description: partial.description ?? partial.id,
    branch: 'grupo',
    method: 'pix',
    createdAt: `${partial.date}T12:00:00.000Z`,
    origin: 'integration',
    paymentStatus: 'paid',
    ...partial,
  };
}

const db: DatabaseShape = {
  settings: { openingBalance: 1000, groupName: 'Arno' },
  movementTypes: [
    movement({ id: 'mt-doacao', name: 'Doação', direction: 'income' }),
    movement({ id: 'mt-sede', name: 'Sede', direction: 'expense' }),
  ],
  members: [],
  memberGuardians: [],
  memberSiblings: [],
  memberAccounts: [],
  fees: [],
  projects: [
    {
      id: 'p1',
      branch: 'escoteiro',
      year: 2026,
      name: 'Projeto',
      description: '',
      items: [],
      origin: 'integration',
      createdAt: '2026-01-01T12:00:00.000Z',
    },
  ],
  transactions: [
    tx({
      id: 't1',
      date: '2026-08-10',
      type: 'income',
      amount: 200,
      description: 'Doação',
    }),
    tx({
      id: 't2',
      date: '2026-08-20',
      type: 'expense',
      amount: 50,
      movementTypeId: 'mt-sede',
      nature: 'fixed',
      projectId: 'p1',
      description: 'Aluguel',
    }),
    tx({
      id: 't3',
      date: '2026-09-02',
      type: 'income',
      amount: 80,
      branch: 'escoteiro',
    }),
  ],
};

describe('finance helpers', () => {
  it('detects dates in range', () => {
    expect(inRange('2026-08-10', '2026-08-01', '2026-08-31')).toBe(true);
    expect(inRange('2026-09-01', '2026-08-01', '2026-08-31')).toBe(false);
  });

  it('sums amounts', () => {
    expect(sumBy([{ n: 1.1 }, { n: 2.2 }], (row) => row.n)).toBe(3.3);
  });

  it('computes cash balance with opening', () => {
    expect(cashBalance(db, '2026-08-10')).toBe(1200);
    expect(cashBalance(db, '2026-08-20')).toBe(1150);
  });

  it('ignores pending transactions in cash totals', () => {
    const pendingDb: DatabaseShape = {
      ...db,
      transactions: [
        ...db.transactions,
        tx({
          id: 't4',
          date: '2026-08-15',
          type: 'income',
          amount: 999,
          paymentStatus: 'pending',
        }),
      ],
    };
    expect(cashBalance(pendingDb, '2026-08-20')).toBe(1150);
    expect(cashFlow(pendingDb, '2026-08-01', '2026-08-31').months[0]?.income).toBe(200);
  });

  it('builds monthly cash flow', () => {
    const flow = cashFlow(db, '2026-08-01', '2026-08-31');
    expect(flow.opening).toBe(1000);
    expect(flow.months).toHaveLength(1);
    expect(flow.months[0]?.income).toBe(200);
    expect(flow.months[0]?.expense).toBe(50);
    expect(flow.closing).toBe(1150);
  });

  it('aggregates project actuals', () => {
    const actuals = projectActuals(db, 'p1');
    expect(actuals.expense).toBe(50);
    expect(actuals.income).toBe(0);
    expect(actuals.byItem).toEqual([]);
  });

  it('matches project item actuals by movement type', () => {
    const withItems: DatabaseShape = {
      ...db,
      projects: [
        {
          ...db.projects[0],
          items: [
            {
              id: 'i1',
              category: 'Sede',
              description: 'Aluguel',
              planned: 80,
              movementTypeId: 'mt-sede',
            },
          ],
        },
      ],
    };
    const actuals = projectActuals(withItems, 'p1');
    expect(actuals.byItem[0]).toEqual({ itemId: 'i1', income: 0, expense: 50 });
  });

  it('counts each transaction once when items share a movement type', () => {
    const shared = (items: { id: string; description: string; planned: number }[], txs: Transaction[]) =>
      projectActuals(
        {
          ...db,
          transactions: txs,
          projects: [
            {
              ...db.projects[0],
              items: items.map((item) => ({ ...item, category: 'Sede', movementTypeId: 'mt-sede' })),
            },
          ],
        },
        'p1',
      ).byItem;
    const items = [
      { id: 'sucos', description: 'Sucos', planned: 140 },
      { id: 'salgados', description: 'Salgados', planned: 400 },
    ];
    const base = { date: '2026-09-28', type: 'expense' as const, movementTypeId: 'mt-sede', projectId: 'p1' };

    // Sem descrição que desempate: rateio pelo previsto, soma fecha com o total.
    const split = shared(items, [tx({ ...base, id: 't1', amount: 789.9, description: 'teste3' })]);
    expect(split).toEqual([
      { itemId: 'sucos', income: 0, expense: 204.79 },
      { itemId: 'salgados', income: 0, expense: 585.11 },
    ]);

    // Descrição do lançamento aponta o item.
    const named = shared(items, [
      tx({ ...base, id: 't1', amount: 100, description: 'Compra de salgados' }),
      tx({ ...base, id: 't2', amount: 30, description: 'Sucos do chá' }),
    ]);
    expect(named).toEqual([
      { itemId: 'sucos', income: 0, expense: 30 },
      { itemId: 'salgados', income: 0, expense: 100 },
    ]);

    // Nada previsto: divide igualmente.
    const zero = shared(
      items.map((item) => ({ ...item, planned: 0 })),
      [tx({ ...base, id: 't1', amount: 10, description: 'x' })],
    );
    expect(zero.map((row) => row.expense)).toEqual([5, 5]);
  });

  it('paces the budget by the calendar of the selected year', () => {
    const today = new Date(2026, 9, 3);
    expect(budgetPaceMonth(2025, today)).toBe(12);
    expect(budgetPaceMonth(2026, today)).toBe(10);
    expect(budgetPaceMonth(2027, today)).toBeNull();
  });

  it('scopes dashboard totals and chart to the selected month or the whole year', () => {
    const august = dashboard(db, 2026, 8);
    expect(august.chart).toHaveLength(1);
    expect(august.chart[0]?.month).toBe('2026-08');
    expect(august.income).toBe(200);
    expect(august.expense).toBe(50);
    expect(august.chart[0]?.balance).toBe(150);
    expect(august.current).toBe(1150);
    expect(august.budget.actualExpense).toBe(50);

    const year = dashboard(db, 2026, 0);
    expect(year.chart).toHaveLength(12);
    expect(year.income).toBe(280);
    expect(year.expense).toBe(50);
    expect(year.chart[7]?.balance).toBe(150);
    expect(year.chart[8]?.balance).toBe(80);
    expect(year.budget.actualExpense).toBe(50);
  });

  it('classifies budget status as ok, watch or over', () => {
    expect(budgetStatus(1200, 100, 1)).toBe('ok');
    expect(budgetStatus(1200, 200, 1)).toBe('watch');
    expect(budgetStatus(1200, 1300, 6)).toBe('over');
    expect(budgetStatus(1200, 200, null)).toBe('ok');
  });

  it('consolidates annual budget by branch and movement type', () => {
    const withPlan: DatabaseShape = {
      ...db,
      projects: [
        {
          ...db.projects[0]!,
          items: [
            {
              id: 'i1',
              category: 'Sede',
              description: 'Aluguel',
              planned: 80,
              movementTypeId: 'mt-sede',
            },
          ],
        },
        {
          id: 'p2',
          branch: 'grupo',
          year: 2026,
          name: 'Grupo',
          description: '',
          items: [
            {
              id: 'i2',
              category: 'Sede',
              description: 'Manutenção',
              planned: 20,
              movementTypeId: 'mt-sede',
            },
          ],
          origin: 'integration',
          createdAt: '2026-01-01T12:00:00.000Z',
        },
      ],
      transactions: [
        ...db.transactions,
        tx({
          id: 't5',
          date: '2026-03-01',
          type: 'expense',
          amount: 90,
          movementTypeId: 'mt-sede',
          projectId: 'p1',
          description: 'Extra',
        }),
      ],
    };

    const budget = yearBudget(withPlan, 2026, 3);
    expect(budget.plannedExpense).toBe(100);
    expect(budget.actualExpense).toBe(140);
    expect(budget.remaining).toBe(-40);
    expect(budget.pctUsed).toBe(140);

    const escoteiro = budget.byBranch.find((row) => row.branch === 'escoteiro');
    expect(escoteiro?.planned).toBe(80);
    expect(escoteiro?.actual).toBe(140);
    expect(escoteiro?.status).toBe('over');

    const sede = budget.byMovementType.find((row) => row.movementTypeId === 'mt-sede');
    expect(sede?.planned).toBe(100);
    expect(sede?.actual).toBe(140);
    expect(sede?.status).toBe('over');
  });

  it('filters a custom fiscal report', () => {
    const report = customReport(db, {
      from: '2026-08-01',
      to: '2026-08-31',
      branches: [],
      types: ['expense'],
      natures: [],
      movementTypeIds: [],
      groupBy: 'movementType',
    });
    expect(report.transactions).toHaveLength(1);
    expect(report.totals.expense).toBe(50);
    expect(report.ledger[0]?.description).toBe('Aluguel');
  });

  it('filters by branch and opens with that branch balance only', () => {
    const fixture: DatabaseShape = {
      ...db,
      transactions: [
        ...db.transactions,
        tx({
          id: 't-lob-prior',
          date: '2026-07-15',
          type: 'income',
          amount: 40,
          branch: 'lobinho',
          description: 'Doação lobinho',
        }),
        tx({
          id: 't-lob-period',
          date: '2026-08-12',
          type: 'income',
          amount: 30,
          branch: 'lobinho',
          description: 'Doação lobinho ago',
        }),
      ],
    };

    const report = customReport(fixture, {
      from: '2026-08-01',
      to: '2026-08-31',
      branches: ['lobinho'],
      types: [],
      natures: [],
      movementTypeIds: [],
      groupBy: 'branch',
    });

    expect(report.transactions).toHaveLength(1);
    expect(report.rows).toEqual([expect.objectContaining({ key: 'lobinho', income: 30, count: 1 })]);
    expect(report.opening).toBe(40);
    expect(report.closing).toBe(70);
    expect(report.ledger.every((line) => line.branch === 'lobinho')).toBe(true);
  });

  it('uses the caixinha of the month and profile (pioneiro R$ 5, março/abril R$ 5)', () => {
    const fixture: DatabaseShape = {
      ...db,
      members: [
        {
          id: 'm-pio',
          name: 'Caio',
          email: '',
          phone: '',
          branch: 'pioneiro',
          role: 'jovem',
          monthlyFee: 39.5,
          status: 'active',
          joinedAt: '2026-03-01',
          clubeLtc: false,
          origin: 'manual',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
      ],
      movementTypes: [...db.movementTypes, movement({ id: 'mt-mens', name: 'Mensalidade', direction: 'income' })],
    };
    const base = { type: 'income' as const, movementTypeId: 'mt-mens' };
    expect(
      amountForBranchView(
        fixture,
        tx({ ...base, id: 'a', date: '2026-08-10', amount: 39.5, branch: 'pioneiro', memberId: 'm-pio' }),
      ),
    ).toBe(5);
    expect(
      amountForBranchView(fixture, tx({ ...base, id: 'b', date: '2026-03-10', amount: 60, branch: 'lobinho' })),
    ).toBe(5);
    expect(
      amountForBranchView(fixture, tx({ ...base, id: 'c', date: '2026-08-10', amount: 89.5, branch: 'lobinho' })),
    ).toBe(8);
  });

  it('attributes only the ramo caixinha (R$ 8) from mensalidades in branch views', () => {
    const fixture: DatabaseShape = {
      ...db,
      movementTypes: [...db.movementTypes, movement({ id: 'mt-mens', name: 'Mensalidade', direction: 'income' })],
      transactions: [
        ...db.transactions,
        tx({
          id: 't-mens-lob',
          date: '2026-08-10',
          type: 'income',
          amount: 89.5,
          branch: 'lobinho',
          movementTypeId: 'mt-mens',
          description: 'Mensalidade agosto — Ana',
        }),
        tx({
          id: 't-doacao-lob',
          date: '2026-08-11',
          type: 'income',
          amount: 50,
          branch: 'lobinho',
          description: 'Doação campanha',
        }),
      ],
    };

    const byBranch = customReport(fixture, {
      from: '2026-08-01',
      to: '2026-08-31',
      branches: [],
      types: [],
      natures: [],
      movementTypeIds: [],
      groupBy: 'branch',
    });
    const lobinho = byBranch.rows.find((row) => row.key === 'lobinho');
    expect(lobinho?.income).toBe(58); // 8 caixinha + 50 doação
    expect(lobinho?.count).toBe(2);
    // Visão por ramo não mistura saldo-caixa do grupo no saldo inicial.
    expect(byBranch.opening).toBe(0);

    const fiscal = customReport(fixture, {
      from: '2026-08-01',
      to: '2026-08-31',
      branches: [],
      types: [],
      natures: [],
      movementTypeIds: [],
      groupBy: 'movementType',
    });
    const mensalidade = fiscal.rows.find((row) => row.key === 'mt-mens');
    expect(mensalidade?.income).toBe(89.5);
    expect(fiscal.opening).toBe(1000);

    // Comissão fiscal com filtro de ramo mantém valor integral da mensalidade.
    const fiscalLob = customReport(fixture, {
      from: '2026-08-01',
      to: '2026-08-31',
      branches: ['lobinho'],
      types: [],
      natures: [],
      movementTypeIds: [],
      groupBy: 'movementType',
    });
    expect(fiscalLob.totals.income).toBe(139.5);
    expect(fiscalLob.ledger.find((line) => line.id === 't-mens-lob')?.income).toBe(89.5);
  });

  it('groups a custom report by account holder', () => {
    const fixture: DatabaseShape = {
      ...db,
      memberAccounts: [
        {
          id: 'acc-1',
          memberId: 'm1',
          holderName: 'Conta Teste',
          holderKind: 'other',
          relationship: 'titular',
          pixKey: '',
          bank: '',
          agency: '',
          accountNumber: '',
          document: '',
          isPrimary: true,
          active: true,
          origin: 'manual',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      transactions: db.transactions.map((t) => (t.id === 't2' ? { ...t, memberAccountId: 'acc-1' } : { ...t })),
    };

    const report = customReport(fixture, {
      from: '2026-08-01',
      to: '2026-08-31',
      branches: [],
      types: [],
      natures: [],
      movementTypeIds: [],
      groupBy: 'account',
    });

    const labeled = report.rows.map((row) => row.label).sort();
    expect(labeled).toEqual(['Conta Teste', 'Sem conta vinculada']);
    expect(report.rows.find((row) => row.label === 'Conta Teste')?.expense).toBe(50);
  });

  it('separa resultado dos eventos externos e pagantes dos tipos internos', () => {
    const member = (memberId: string, name: string) => ({
      id: memberId,
      name,
      email: '',
      phone: '',
      branch: 'escoteiro' as const,
      role: 'jovem' as const,
      monthlyFee: 89.5,
      status: 'active' as const,
      joinedAt: '2026-03-01',
      clubeLtc: false,
      origin: 'manual' as const,
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    const fixture: DatabaseShape = {
      ...db,
      members: [member('m-ana', 'ANA'), member('m-bia', 'BIA')],
      movementTypes: [
        ...db.movementTypes,
        movement({ id: 'mt-pastel', name: 'Pastelada', direction: 'both', audience: 'external' }),
        movement({ id: 'mt-bivaque', name: 'Bivaque Distrital', direction: 'both', audience: 'internal' }),
      ],
      transactions: [
        ...db.transactions,
        tx({ id: 'p1', date: '2026-08-02', type: 'expense', amount: 120, movementTypeId: 'mt-pastel' }),
        tx({ id: 'p2', date: '2026-08-03', type: 'income', amount: 450, movementTypeId: 'mt-pastel' }),
        tx({
          id: 'b1',
          date: '2026-08-04',
          type: 'income',
          amount: 60,
          movementTypeId: 'mt-bivaque',
          memberId: 'm-bia',
        }),
        tx({
          id: 'b2',
          date: '2026-08-05',
          type: 'income',
          amount: 60,
          movementTypeId: 'mt-bivaque',
          memberId: 'm-ana',
        }),
        tx({
          id: 'b3',
          date: '2026-08-09',
          type: 'income',
          amount: 20,
          movementTypeId: 'mt-bivaque',
          memberId: 'm-ana',
        }),
        tx({ id: 'b4', date: '2026-08-06', type: 'income', amount: 60, movementTypeId: 'mt-bivaque' }),
        tx({ id: 'b5', date: '2026-08-07', type: 'expense', amount: 90, movementTypeId: 'mt-bivaque' }),
        tx({
          id: 'b6',
          date: '2026-08-08',
          type: 'income',
          amount: 60,
          movementTypeId: 'mt-bivaque',
          memberId: 'm-bia',
          paymentStatus: 'pending',
        }),
      ],
    };
    const query = {
      from: '2026-08-01',
      to: '2026-08-31',
      branches: [],
      types: [],
      natures: [],
      groupBy: 'movementType' as const,
    };

    const all = customReport(fixture, { ...query, movementTypeIds: [] });
    expect(all.events).toEqual([
      { movementTypeId: 'mt-pastel', name: 'Pastelada', income: 450, expense: 120, net: 330, count: 2 },
    ]);
    // Sem filtro, o agrupamento por tipo de conta lista os pagantes de todo tipo interno com entrada.
    expect(all.payers.map((group) => group.name)).toEqual(['Bivaque Distrital']);

    const byMonth = customReport(fixture, { ...query, groupBy: 'month', movementTypeIds: [] });
    expect(byMonth.payers).toEqual([]);

    const bivaque = customReport(fixture, { ...query, movementTypeIds: ['mt-bivaque', 'mt-pastel'] });
    expect(bivaque.payers).toHaveLength(1);
    const [payers] = bivaque.payers;
    expect(payers?.name).toBe('Bivaque Distrital');
    expect(payers?.payers.map((p) => [p.name, p.amount, p.count, p.lastDate])).toEqual([
      ['ANA', 80, 2, '2026-08-09'],
      ['BIA', 60, 1, '2026-08-04'],
    ]);
    expect(payers?.total).toBe(200);
    expect(payers?.unlinked).toEqual({ amount: 60, count: 1 });
  });
});
