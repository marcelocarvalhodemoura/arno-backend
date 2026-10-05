import { createFeePeriod, deleteFeePeriod, updateFeePeriod, type FeePeriodInput } from './fee-schedule';
import { DEFAULT_FEE_SCHEDULE } from './fee-table';
import { syncMensalidades } from './mensalidades';
import type { DatabaseShape, Member } from '../shared/types';

function member(partial: Partial<Member> & Pick<Member, 'id' | 'name'>): Member {
  return {
    email: `${partial.id}@arnofriedrich.org.br`,
    phone: '',
    branch: 'escoteiro',
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

function emptyDb(partial: Partial<DatabaseShape> = {}): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Arno' },
    ...partial,
  };
}

function inputFrom(startMonth: string, endMonth: string | null = null): FeePeriodInput {
  const current = DEFAULT_FEE_SCHEDULE[1];
  return {
    startMonth,
    endMonth,
    note: '',
    regular: { ...current.regular, snack: 30 },
    pioneer: current.pioneer,
    familyNonMember: current.familyNonMember,
    familyMember: current.familyMember,
  };
}

describe('fee schedule', () => {
  it('saves the default table on the first change and adds the new period', () => {
    const db = emptyDb();
    createFeePeriod(db, inputFrom('2027-03'), 'u1', '2026-10-04');
    expect(db.feeSchedule?.map((period) => period.startMonth)).toEqual(['2026-03', '2026-05', '2027-03']);
  });

  it('recalculates open mensalidades and keeps paid ones', () => {
    const db = emptyDb({ members: [member({ id: 'm1', name: 'Ana Souza' })] });
    syncMensalidades(db, 2026, 'u1', '2026-10-04');
    const september = db.transactions.find((tx) => tx.date === '2026-09-10')!;
    september.paymentStatus = 'paid';
    september.paidAt = '2026-09-08';
    const paidAmount = september.amount;

    createFeePeriod(db, inputFrom('2026-11', '2026-11'), 'u1', '2026-10-04');

    const november = db.transactions.find((tx) => tx.date === '2026-11-10')!;
    const october = db.transactions.find((tx) => tx.date === '2026-10-10')!;
    expect(november.amount).toBe(95.5);
    expect(october.amount).toBe(89.5);
    expect(september.amount).toBe(paidAmount);
  });

  it('rejects invalid periods', () => {
    const db = emptyDb();
    expect(() => createFeePeriod(db, inputFrom('2026-05'), 'u1')).toThrow('Já existe um período começando em 2026-05');
    expect(() => createFeePeriod(db, inputFrom('2027-05', '2027-03'), 'u1')).toThrow('antes do início');
    expect(() => createFeePeriod(db, inputFrom('2027-13'), 'u1')).toThrow('Mês de início inválido');
    expect(() => createFeePeriod(db, { ...inputFrom('2027-03'), familyMember: null }, 'u1')).toThrow(
      'não sócio e para sócio',
    );
  });

  it('moves members with a family discount to the new special value', () => {
    const db = emptyDb({
      members: [member({ id: 'm1', name: 'Bia Lima', chiefChild: true, feeOverride: 82 })],
    });
    const current = db.feeSchedule ?? DEFAULT_FEE_SCHEDULE;
    const periodId = current[1].id;
    const input = inputFrom('2026-05');
    updateFeePeriod(db, periodId, { ...input, familyNonMember: { ...input.familyNonMember!, group: 77 } }, 'u1');
    expect(db.members[0].feeOverride).toBe(85);
    expect(db.members[0].monthlyFee).toBe(85);
  });

  it('keeps at least one period', () => {
    const db = emptyDb();
    deleteFeePeriod(db, DEFAULT_FEE_SCHEDULE[0].id, 'u1');
    expect(() => deleteFeePeriod(db, DEFAULT_FEE_SCHEDULE[1].id, 'u1')).toThrow('pelo menos um período');
  });
});
