import { splitTransaction } from './split';
import type { DatabaseShape, MovementType, Transaction } from '../shared/types';

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

function dbWithTx(amount = 150): DatabaseShape {
  const tx: Transaction = {
    id: 'tx1',
    date: '2026-09-18',
    type: 'income',
    nature: 'variable',
    movementTypeId: 'mt-pix',
    description: 'Pix agrupado',
    amount,
    branch: 'grupo',
    method: 'pix',
    paymentStatus: 'paid',
    origin: 'sicredi',
    createdAt: '2026-09-18T12:00:00.000Z',
  };
  return {
    settings: { openingBalance: 0, groupName: 'Arno' },
    movementTypes: [
      movement({ id: 'mt-pix', name: 'A identificar', direction: 'both' }),
      movement({ id: 'mt-men', name: 'Mensalidade', direction: 'income' }),
      movement({ id: 'mt-camp', name: 'Acampamento', direction: 'income' }),
    ],
    members: [],
    memberGuardians: [],
    memberAccounts: [],
    fees: [],
    projects: [],
    transactions: [tx],
  };
}

describe('splitTransaction', () => {
  it('splits one credit into two ledger rows that sum to the original', () => {
    const db = dbWithTx(150);
    const created = splitTransaction(
      db,
      'tx1',
      [
        { amount: 60, movementTypeId: 'mt-men', description: 'Mensalidade setembro' },
        { amount: 90, movementTypeId: 'mt-camp', description: 'Taxa de acampamento' },
      ],
      'u1',
    );
    expect(created).toHaveLength(2);
    expect(db.transactions).toHaveLength(2);
    expect(db.transactions[0].amount).toBe(60);
    expect(db.transactions[0].movementTypeId).toBe('mt-men');
    expect(db.transactions[1].amount).toBe(90);
    expect(db.transactions[1].description).toBe('Taxa de acampamento');
  });

  it('rejects parts that do not sum to the original amount', () => {
    const db = dbWithTx(150);
    expect(() =>
      splitTransaction(
        db,
        'tx1',
        [
          { amount: 60, movementTypeId: 'mt-men', description: 'Mensalidade' },
          { amount: 60, movementTypeId: 'mt-camp', description: 'Acampamento' },
        ],
        'u1',
      ),
    ).toThrow(/soma das partes/);
  });
});
