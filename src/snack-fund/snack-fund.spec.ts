import {
  buildSnackFundPreview,
  buildSnackFundYearSummary,
  isSnackExpenseMovementName,
  snackShareOf,
} from './snack-fund';
import type { DatabaseShape, Member, MovementType, Transaction } from '../shared/types';

function member(partial: Partial<Member> & Pick<Member, 'id' | 'name' | 'joinedAt'>): Member {
  return {
    email: `${partial.id}@arnofriedrich.org.br`,
    phone: '',
    branch: 'escoteiro',
    role: 'jovem',
    monthlyFee: 89.5,
    status: 'active',
    clubeLtc: false,
    origin: 'manual',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...partial,
  };
}

function emptyDb(partial: Partial<DatabaseShape> = {}): DatabaseShape {
  const mensalidade: MovementType = {
    id: 'mt-men',
    name: 'Mensalidade',
    direction: 'income',
    description: '',
    pixKey: '',
    branch: 'grupo',
    active: true,
    origin: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const alimentacao: MovementType = {
    id: 'mt-ali',
    name: 'Alimentação',
    direction: 'expense',
    description: '',
    pixKey: '',
    branch: 'grupo',
    active: true,
    origin: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [mensalidade, alimentacao],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Arno' },
    ...partial,
  };
}

function mensalidadeTx(
  partial: Partial<Transaction> & Pick<Transaction, 'id' | 'memberId' | 'date' | 'amount'>,
): Transaction {
  return {
    type: 'income',
    nature: 'fixed',
    movementTypeId: 'mt-men',
    description: 'Mensalidade',
    branch: 'grupo',
    method: 'pix',
    paymentStatus: 'paid',
    clubFeeIncluded: true,
    origin: 'manual',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...partial,
  };
}

describe('snack-fund', () => {
  it('recognizes lanche/alimentação movement names', () => {
    expect(isSnackExpenseMovementName('Alimentação')).toBe(true);
    expect(isSnackExpenseMovementName('Lanche do sábado')).toBe(true);
    expect(isSnackExpenseMovementName('Sede')).toBe(false);
  });

  it('uses R$ 24 only for regular maio–nov base (no club fee in the share)', () => {
    const regular = member({ id: 'm1', name: 'Ana', joinedAt: '2026-03-01' });
    expect(snackShareOf(regular, '2026-05-10')).toBe(24);
    expect(snackShareOf(regular, '2026-03-10')).toBe(0);
    expect(snackShareOf({ ...regular, branch: 'pioneiro' }, '2026-05-10')).toBe(0);
    expect(snackShareOf({ ...regular, feeOverride: 82 }, '2026-05-10')).toBe(0);
    expect(snackShareOf({ ...regular, clubeLtc: true, monthlyFee: 75 }, '2026-05-10')).toBe(24);
  });

  it('computes available as collected snack shares minus alimentação expenses for paid month', () => {
    const ana = member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-01' });
    const bruno = member({ id: 'm2', name: 'Bruno Lima', joinedAt: '2026-03-01', branch: 'pioneiro' });
    const db = emptyDb({
      members: [ana, bruno],
      transactions: [
        mensalidadeTx({
          id: 't1',
          memberId: 'm1',
          date: '2026-05-10',
          paidAt: '2026-05-08',
          amount: 89.5,
        }),
        mensalidadeTx({
          id: 't2',
          memberId: 'm2',
          date: '2026-05-10',
          paidAt: '2026-05-09',
          amount: 39.5,
        }),
        {
          id: 'e1',
          date: '2026-05-20',
          type: 'expense',
          nature: 'variable',
          movementTypeId: 'mt-ali',
          description: 'Mercado do lanche',
          amount: 30,
          branch: 'grupo',
          method: 'pix',
          paymentStatus: 'paid',
          paidAt: '2026-05-20',
          origin: 'manual',
          createdAt: '2026-05-20T00:00:00.000Z',
        },
      ],
    });

    const preview = buildSnackFundPreview(db, 2026, 5);
    expect(preview.incomeCount).toBe(1);
    expect(preview.collected).toBe(24);
    expect(preview.spent).toBe(30);
    expect(preview.available).toBe(-6);
    expect(preview.expenseLines[0].description).toBe('Mercado do lanche');
  });

  it('builds year summary aggregating months with activity', () => {
    const ana = member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-01' });
    const db = emptyDb({
      members: [ana],
      transactions: [
        mensalidadeTx({
          id: 't1',
          memberId: 'm1',
          date: '2026-05-10',
          paidAt: '2026-05-08',
          amount: 89.5,
        }),
        mensalidadeTx({
          id: 't2',
          memberId: 'm1',
          date: '2026-06-10',
          paidAt: '2026-06-05',
          amount: 89.5,
        }),
        {
          id: 'e1',
          date: '2026-06-15',
          type: 'expense',
          nature: 'variable',
          movementTypeId: 'mt-ali',
          description: 'Padaria',
          amount: 40,
          branch: 'grupo',
          method: 'cash',
          paymentStatus: 'paid',
          paidAt: '2026-06-15',
          origin: 'manual',
          createdAt: '2026-06-15T00:00:00.000Z',
        },
      ],
    });

    const summary = buildSnackFundYearSummary(db, 2026);
    expect(summary.months).toHaveLength(2);
    expect(summary.collected).toBe(48);
    expect(summary.spent).toBe(40);
    expect(summary.available).toBe(8);
  });
});
