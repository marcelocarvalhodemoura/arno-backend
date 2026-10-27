import { buildBranchLines, buildBranchStatement, buildMoneyMap } from './branch-ledger';
import { syncAllocations } from '../allocations/allocations';
import { DEFAULT_FEE_SCHEDULE } from '../mensalidades/fee-table';
import type { DatabaseShape, Member, MovementType, Transaction } from '../shared/types';

function type(id: string, name: string, direction: MovementType['direction']): MovementType {
  return {
    id,
    name,
    direction,
    description: '',
    pixKey: '',
    branch: 'grupo',
    active: true,
    origin: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function member(partial: Partial<Member> & Pick<Member, 'id'>): Member {
  return {
    name: `Jovem ${partial.id}`,
    email: `${partial.id}@arnofriedrich.org.br`,
    phone: '',
    branch: 'lobinho',
    role: 'jovem',
    monthlyFee: 89.5,
    status: 'active',
    joinedAt: '2026-03-01',
    clubeLtc: false,
    origin: 'manual',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...partial,
  };
}

function tx(
  partial: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'amount' | 'movementTypeId'>,
): Transaction {
  return {
    type: 'income',
    nature: 'variable',
    description: partial.id,
    branch: 'grupo',
    method: 'pix',
    paymentStatus: 'paid',
    origin: 'manual',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...partial,
  };
}

function db(): DatabaseShape {
  const data: DatabaseShape = {
    members: [member({ id: 'm1' }), member({ id: 'm2', branch: 'senior' })],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [
      type('men', 'Mensalidade', 'income'),
      type('cha', 'Chá da Alcatéia', 'income'),
      type('acamp', 'Acampamento', 'both'),
      type('lanche', 'Lanche sábado a tarde', 'expense'),
      type('clube', 'Repasse Lindóia Tênis Clube', 'expense'),
      type('sede', 'Sede', 'expense'),
    ],
    fees: [],
    projects: [],
    feeSchedule: structuredClone(DEFAULT_FEE_SCHEDULE),
    settings: { openingBalance: 100, groupName: 'Arno' },
    transactions: [
      // Mensalidade lobinho no prazo: 43 grupo + 8 caixinha + 24 lanche + 10 clube + 4,50 diluição.
      tx({
        id: 'mens1',
        movementTypeId: 'men',
        memberId: 'm1',
        date: '2026-05-10',
        paidAt: '2026-05-08',
        amount: 89.5,
        branch: 'lobinho',
      }),
      // Mensalidade sênior paga a menos: 10 de diferença vai para "a conferir".
      tx({
        id: 'mens2',
        movementTypeId: 'men',
        memberId: 'm2',
        date: '2026-06-10',
        paidAt: '2026-06-05',
        amount: 79.5,
        branch: 'senior',
      }),
      // Mensalidade sem associado: inteira em "a conferir".
      tx({ id: 'mens3', movementTypeId: 'men', date: '2026-06-10', amount: 60 }),
      tx({ id: 'cha', movementTypeId: 'cha', date: '2026-05-20', amount: 300, branch: 'lobinho' }),
      tx({ id: 'acamp', movementTypeId: 'acamp', type: 'expense', date: '2026-07-02', amount: 120, branch: 'lobinho' }),
      tx({ id: 'lanche', movementTypeId: 'lanche', type: 'expense', date: '2026-05-23', amount: 30 }),
      tx({ id: 'repasse', movementTypeId: 'clube', type: 'expense', date: '2026-06-01', amount: 10 }),
      tx({ id: 'sede', movementTypeId: 'sede', type: 'expense', date: '2026-05-15', amount: 50 }),
      tx({
        id: 'pendente',
        movementTypeId: 'cha',
        date: '2026-05-20',
        amount: 999,
        branch: 'lobinho',
        paymentStatus: 'pending',
      }),
    ],
  };
  syncAllocations(data, '2026-10-27T12:00:00.000Z');
  return data;
}

describe('branch ledger', () => {
  it('splits every real into exactly one destination and the destinations add up to the cash balance', () => {
    const map = buildMoneyMap(db());
    const balance = Object.fromEntries(map.rows.map((row) => [row.bucket, row.balance]));
    expect(balance).toMatchObject({
      // 100 abertura + 47,50 (mens1) + 47,50 (mens2 pela tabela) − 50 sede
      grupo: 145,
      lobinho: 188, // 8 caixinha + 300 chá − 120 acampamento
      senior: 8,
      lanche: 18, // 24 + 24 − 30
      clube: 10, // 10 + 10 − 10 repassado
      conferir: 50, // −10 (mens2 a menos) + 60 (sem associado)
    });
    expect(map.total).toBe(map.cashBalance);
    expect(map.cashBalance).toBe(419); // 100 + 89,50 + 79,50 + 60 + 300 − 120 − 30 − 10 − 50
  });

  it('closes with the cash balance at any cut-off date', () => {
    const data = db();
    for (const until of ['2026-05-09', '2026-05-31', '2026-06-04', '2026-06-30', '2026-12-31']) {
      const map = buildMoneyMap(data, until);
      expect(map.total).toBe(map.cashBalance);
    }
  });

  it('separates what came before the period from what moved inside it', () => {
    const map = buildMoneyMap(db(), '2026-06-30', '2026-06-01');
    const lobinho = map.rows.find((row) => row.bucket === 'lobinho')!;
    expect(lobinho).toMatchObject({ opening: 308, income: 0, expense: 0, balance: 308 });
    const grupo = map.rows.find((row) => row.bucket === 'grupo')!;
    // Antes de junho: 100 + 47,50 − 50; em junho: 47,50 da mensalidade do sênior.
    expect(grupo).toMatchObject({ opening: 97.5, income: 47.5, expense: 0, balance: 145 });
    expect(map.total).toBe(map.cashBalance);
  });

  it('builds the branch statement month by month with running balance and sources by movement type', () => {
    const statement = buildBranchStatement(db(), 'lobinho');
    expect(statement.months).toEqual([
      { yearMonth: '2026-05', caixinha: 8, income: 300, expense: 0, net: 308, balance: 308 },
      { yearMonth: '2026-06', caixinha: 0, income: 0, expense: 0, net: 0, balance: 308 },
      { yearMonth: '2026-07', caixinha: 0, income: 0, expense: 120, net: -120, balance: 188 },
    ]);
    expect(statement.totals).toEqual({ caixinha: 8, income: 300, expense: 120, balance: 188 });
    expect(statement.sources.map((source) => [source.kind, source.name, source.amount])).toEqual([
      ['caixinha', 'Caixinha das mensalidades', 8],
      ['receita', 'Chá da Alcatéia', 300],
      ['saida', 'Acampamento', 120],
    ]);
  });

  it('uses the member branch stored in the split for the caixinha, even if the member moves later', () => {
    const data = db();
    data.members[0].branch = 'escoteiro';
    expect(buildBranchStatement(data, 'lobinho').totals.caixinha).toBe(8);
    expect(buildBranchStatement(data, 'escoteiro').months).toEqual([]);
  });

  it('lists the month lines with the caixinha next to the amount paid', () => {
    const lines = buildBranchLines(db(), 'lobinho', '2026-05');
    expect(lines).toEqual([
      expect.objectContaining({
        transactionId: 'mens1',
        kind: 'caixinha',
        amount: 8,
        paid: 89.5,
        memberName: 'Jovem m1',
      }),
      expect.objectContaining({ transactionId: 'cha', kind: 'receita', amount: 300 }),
    ]);
  });
});
