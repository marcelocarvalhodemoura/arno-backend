import {
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
});
