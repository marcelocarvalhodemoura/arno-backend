import { applyBarter, planBarter, type Barter } from './barter';
import { syncMensalidades } from '../mensalidades/mensalidades';
import { updateTransaction } from '../ledger/transactions';
import type { DatabaseShape, Member, MovementType } from '../shared/types';

const TODAY = '2026-09-20';

function member(partial: Partial<Member> & Pick<Member, 'id' | 'name'>): Member {
  return {
    email: `${partial.id}@arnofriedrich.org.br`,
    phone: '',
    branch: 'escoteiro',
    role: 'jovem',
    monthlyFee: 60,
    status: 'active',
    clubeLtc: false,
    origin: 'manual',
    joinedAt: '2026-03-01',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...partial,
  };
}

function movement(id: string, name: string, direction: MovementType['direction']): MovementType {
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

/** Bruno e Ana são irmãos; Carla é de outra família. Mensalidades de mar a nov geradas e em aberto. */
function familyDb(): DatabaseShape {
  const db: DatabaseShape = {
    members: [
      member({ id: 'm-bruno', name: 'Bruno' }),
      member({ id: 'm-ana', name: 'Ana' }),
      member({ id: 'm-carla', name: 'Carla' }),
    ],
    memberGuardians: [],
    memberSiblings: [
      { id: 's1', memberId: 'm-bruno', siblingId: 'm-ana', createdAt: '2026-03-01T00:00:00.000Z' },
      { id: 's2', memberId: 'm-ana', siblingId: 'm-bruno', createdAt: '2026-03-01T00:00:00.000Z' },
    ],
    memberAccounts: [],
    movementTypes: [movement('mt-servico', 'Manutenção da sede', 'expense'), movement('mt-doacao', 'Doação', 'income')],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Arno' },
  };
  syncMensalidades(db, 2026, 'u1', TODAY);
  return db;
}

function barter(partial: Partial<Barter>): Barter {
  return {
    id: 'b1',
    donorName: 'Pai do Bruno',
    service: 'Conserto do telhado',
    amount: 100,
    serviceDate: '2026-09-15',
    expenseTypeId: 'mt-servico',
    donationTypeId: 'mt-doacao',
    notes: '',
    status: 'pending',
    decisionNote: '',
    settledIds: [],
    createdAt: '2026-09-15T12:00:00.000Z',
    ...partial,
  };
}

describe('permuta', () => {
  it('abates whole months of the whole family, oldest first, and the rest becomes a donation', () => {
    const db = familyDb();
    const oneMonth = planBarter(db, { memberId: 'm-bruno', amount: 100000, serviceDate: '2026-09-15' }, TODAY).items;
    expect(oneMonth.length).toBeGreaterThan(2);
    // Março da Ana e do Bruno primeiro (mesmo vencimento, por nome), depois abril.
    expect(oneMonth.slice(0, 2).map((item) => [item.memberName, item.dueDate.slice(0, 7)])).toEqual([
      ['Ana', '2026-03'],
      ['Bruno', '2026-03'],
    ]);
    expect(oneMonth[2].dueDate.slice(0, 7)).toBe('2026-04');
    expect(oneMonth.every((item) => item.memberId !== 'm-carla')).toBe(true);

    const twoMonths = oneMonth[0].amount + oneMonth[1].amount;
    const plan = planBarter(db, { memberId: 'm-bruno', amount: twoMonths + 10, serviceDate: '2026-09-15' }, TODAY);
    expect(plan.items).toHaveLength(2);
    expect(plan.coveredAmount).toBe(twoMonths);
    expect(plan.donationAmount).toBe(10);
    expect(plan.nextOpen?.dueDate.slice(0, 7)).toBe('2026-04');
    // A prévia não mexe no caixa.
    expect(db.transactions.every((tx) => tx.paymentStatus === 'pending')).toBe(true);
  });

  it('does not abate a month the service does not cover in full', () => {
    const db = familyDb();
    const first = planBarter(db, { memberId: 'm-carla', amount: 100000, serviceDate: '2026-09-15' }, TODAY).items[0];
    const plan = planBarter(db, { memberId: 'm-carla', amount: first.amount - 0.01, serviceDate: '2026-09-15' }, TODAY);
    expect(plan.items).toHaveLength(0);
    expect(plan.donationAmount).toBe(first.amount - 0.01);
  });

  it('on approval settles the months, records the donation and the service expense, all as barter', () => {
    const db = familyDb();
    const [first, second] = planBarter(
      db,
      { memberId: 'm-bruno', amount: 100000, serviceDate: '2026-09-15' },
      TODAY,
    ).items;
    const amount = first.amount + second.amount + 25;
    const result = applyBarter(db, barter({ memberId: 'm-bruno', amount }), 'u-admin', TODAY);

    expect(result.settledIds.sort()).toEqual([first.transactionId, second.transactionId].sort());
    expect(result.coveredAmount).toBe(first.amount + second.amount);
    expect(result.donationAmount).toBe(25);
    for (const id of result.settledIds) {
      const tx = db.transactions.find((item) => item.id === id)!;
      expect(tx.paymentStatus).toBe('paid');
      expect(tx.method).toBe('barter');
      expect(tx.paidAt).toBe('2026-09-15');
    }
    const donation = db.transactions.find((item) => item.id === result.donationTransactionId)!;
    expect(donation).toMatchObject({ type: 'income', amount: 25, method: 'barter', movementTypeId: 'mt-doacao' });
    const expense = db.transactions.find((item) => item.id === result.expenseTransactionId)!;
    expect(expense).toMatchObject({ type: 'expense', amount, method: 'barter', movementTypeId: 'mt-servico' });

    expect(() => applyBarter(db, barter({ memberId: 'm-bruno', amount }), 'u-admin', TODAY)).toThrow('já foi lançada');
  });

  it('without a child in the group the whole service is a donation', () => {
    const db = familyDb();
    const result = applyBarter(db, barter({ amount: 300 }), 'u-admin', TODAY);
    expect(result.settledIds).toEqual([]);
    expect(result.donationAmount).toBe(300);
    expect(db.transactions.filter((tx) => tx.method === 'barter')).toHaveLength(2);
  });

  it('does not let a normal edit turn a transaction into barter', () => {
    const db = familyDb();
    const tx = db.transactions[0];
    expect(() => updateTransaction(db, tx.id, { method: 'barter' }, 'u1')).toThrow('Permuta');
  });
});
