import { createTransaction, listTransactions, stampPaidAt, updateTransaction } from './transactions';
import type { DatabaseShape, MovementType } from '../shared/types';

function movement(partial: Partial<MovementType> & Pick<MovementType, 'id' | 'name' | 'direction'>): MovementType {
  return {
    description: '',
    pixKey: '',
    branch: 'grupo',
    active: true,
    origin: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function emptyDb(): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [
      movement({ id: 'mt-doa', name: 'Doação', direction: 'income' }),
      movement({ id: 'mt-men', name: 'Mensalidade', direction: 'income' }),
    ],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Arno' },
  };
}

describe('transactions', () => {
  it('creates a paid donation and lists it in range', () => {
    const db = emptyDb();
    const created = createTransaction(
      db,
      {
        date: '2026-08-10',
        type: 'income',
        nature: 'variable',
        movementTypeId: 'mt-doa',
        description: 'Doação Pix',
        amount: 12.5,
        branch: 'grupo',
        method: 'pix',
      },
      'u1',
    );
    expect(created.paymentStatus).toBe('paid');
    expect(created.amount).toBe(12.5);
    expect(listTransactions(db, { from: '2026-08-01', to: '2026-08-31' })).toHaveLength(1);
    expect(listTransactions(db, { from: '2026-09-01', to: '2026-09-30' })).toHaveLength(0);
  });

  it('rejects a type that does not accept the direction', () => {
    const db = emptyDb();
    expect(() =>
      createTransaction(
        db,
        {
          date: '2026-08-10',
          type: 'expense',
          nature: 'variable',
          movementTypeId: 'mt-doa',
          description: 'Saída inválida',
          amount: 10,
          branch: 'grupo',
          method: 'pix',
        },
        'u1',
      ),
    ).toThrow(/não aceita/);
  });

  it('marks pending and stamps paidAt when settling a mensalidade', () => {
    const db = emptyDb();
    const created = createTransaction(
      db,
      {
        date: '2026-08-10',
        type: 'income',
        nature: 'fixed',
        movementTypeId: 'mt-men',
        description: 'Mensalidade agosto',
        amount: 89.5,
        branch: 'escoteiro',
        method: 'pix',
        paymentStatus: 'pending',
      },
      'u1',
    );
    expect(created.paidAt).toBeUndefined();
    const updated = updateTransaction(db, created.id, { paymentStatus: 'paid' }, 'u1');
    expect(updated?.tx.paymentStatus).toBe('paid');
    expect(updated?.tx.paidAt).toBeTruthy();
  });

  it('stampPaidAt keeps an existing paid date', () => {
    const tx = {
      paymentStatus: 'pending' as const,
      date: '2026-08-01',
      paidAt: '2026-08-02',
    };
    stampPaidAt(tx as never, 'Mensalidade', 'paid', undefined, '2026-08-10');
    expect(tx.paidAt).toBe('2026-08-02');
  });
});
