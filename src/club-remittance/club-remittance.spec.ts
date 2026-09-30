import {
  buildClubRemittancePreview,
  buildClubRemittanceYearSummary,
  clubRemittanceExternalId,
  registerClubRemittance,
  remittanceClubShare,
} from './club-remittance';
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
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [mensalidade],
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

describe('club-remittance', () => {
  it('uses punctual R$ 10 or late R$ 20 (without dilution)', () => {
    const profile = member({ id: 'm1', name: 'Ana', joinedAt: '2026-03-01' });
    expect(remittanceClubShare(profile, '2026-05-10', '2026-05-08')).toBe(10);
    expect(remittanceClubShare(profile, '2026-05-10', '2026-05-11')).toBe(20);
    expect(remittanceClubShare(profile, '2026-03-10', '2026-03-10')).toBe(0);
    expect(remittanceClubShare({ ...profile, feeOverride: 82 }, '2026-05-10', '2026-05-08')).toBe(0);
  });

  it('sums only mensalidades paid in the remittance month with club fee included', () => {
    const ana = member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-01' });
    const bruno = member({ id: 'm2', name: 'Bruno Lima', joinedAt: '2026-03-01' });
    const socio = member({
      id: 'm3',
      name: 'Carla Sócia',
      joinedAt: '2026-03-01',
      clubeLtc: true,
      monthlyFee: 75,
    });
    const db = emptyDb({
      members: [ana, bruno, socio],
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
          paidAt: '2026-05-15',
          amount: 99.5,
        }),
        // paid in June — out of May remittance
        mensalidadeTx({
          id: 't3',
          memberId: 'm1',
          date: '2026-06-10',
          paidAt: '2026-06-05',
          amount: 89.5,
        }),
        // club fee removed
        mensalidadeTx({
          id: 't4',
          memberId: 'm2',
          date: '2026-04-10',
          paidAt: '2026-05-20',
          amount: 60,
          clubFeeIncluded: false,
        }),
        // Lindóia member without club fee (default)
        mensalidadeTx({
          id: 't5',
          memberId: 'm3',
          date: '2026-05-10',
          paidAt: '2026-05-09',
          amount: 75,
          clubFeeIncluded: false,
        }),
        // still pending
        mensalidadeTx({
          id: 't6',
          memberId: 'm1',
          date: '2026-07-10',
          amount: 89.5,
          paymentStatus: 'pending',
        }),
      ],
    });

    const preview = buildClubRemittancePreview(db, 2026, 5);
    expect(preview.count).toBe(2);
    expect(preview.total).toBe(30); // 10 + 20
    expect(preview.lines.map((line) => line.memberName)).toEqual(['Ana Souza', 'Bruno Lima']);
    expect(preview.lines[0].clubShare).toBe(10);
    expect(preview.lines[1].clubShare).toBe(20);
    expect(preview.lines[1].late).toBe(true);
    expect(preview.remittance).toBeNull();
  });

  it('registers an expense once and refuses a second remittance for the same month', () => {
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
      ],
    });

    const { remittance, preview } = registerClubRemittance(
      db,
      { year: 2026, month: 5, date: '2026-05-31', method: 'transfer' },
      'u1',
    );
    expect(remittance.type).toBe('expense');
    expect(remittance.amount).toBe(10);
    expect(remittance.externalId).toBe(clubRemittanceExternalId(2026, 5));
    expect(preview.remittance?.transactionId).toBe(remittance.id);
    expect(db.movementTypes.some((type) => type.name === 'Repasse Lindóia Tênis Clube')).toBe(true);

    expect(() => registerClubRemittance(db, { year: 2026, month: 5 }, 'u1')).toThrow(/já foi registrado/);
  });

  it('builds a year summary with only months that have activity', () => {
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
          paidAt: '2026-06-12',
          amount: 99.5,
        }),
      ],
    });
    registerClubRemittance(db, { year: 2026, month: 5, date: '2026-05-31' }, 'u1');
    const summary = buildClubRemittanceYearSummary(db, 2026);
    expect(summary.months).toHaveLength(2);
    expect(summary.months[0]).toMatchObject({ month: 5, total: 10, remitted: true });
    expect(summary.months[1]).toMatchObject({ month: 6, total: 20, remitted: false });
    expect(summary.totalDue).toBe(30);
    expect(summary.totalRemitted).toBe(10);
  });
});
