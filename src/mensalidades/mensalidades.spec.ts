import {
  applyMensalidadeFee,
  buildMensalidadeReport,
  cancelSubsequentMensalidades,
  cellStatus,
  dueDateForMonth,
  firstOwedMonth,
  mensalidadeAmountForTiming,
  nextMonthStart,
  setMensalidadeClubFee,
  setMensalidadeClubFeeBulk,
  settleMensalidade,
  syncMensalidades,
} from './mensalidades';
import type { DatabaseShape, Member, MovementType, Transaction } from '../shared/types';

function member(partial: Partial<Member> & Pick<Member, 'id' | 'name' | 'joinedAt'>): Member {
  return {
    email: `${partial.id}@arnofriedrich.org.br`,
    phone: '',
    branch: 'escoteiro',
    role: 'jovem',
    monthlyFee: 60,
    status: 'active',
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

describe('mensalidades', () => {
  it('uses the configured due day and starts in March', () => {
    expect(dueDateForMonth(2026, 3)).toBe('2026-03-10');
    expect(dueDateForMonth(2026, 4, 10)).toBe('2026-04-10');
    expect(dueDateForMonth(2026, 3, 15)).toBe('2026-03-15');
    expect(dueDateForMonth(2026, 2, 31)).toBe('2026-02-28');
    expect(firstOwedMonth(2026, '2025-11-02')).toBe(3);
    expect(firstOwedMonth(2026, '2026-01-10')).toBe(3);
    expect(firstOwedMonth(2026, '2026-05-20')).toBe(5);
    expect(firstOwedMonth(2026, '2027-03-01')).toBeNull();
  });

  it('marks unpaid months overdue after the due day', () => {
    expect(cellStatus('paid', '2026-03-15', '2026-03-20')).toBe('paid');
    expect(cellStatus('pending', '2026-03-15', '2026-03-14')).toBe('pending');
    expect(cellStatus('pending', '2026-03-15', '2026-03-16')).toBe('overdue');
    expect(cellStatus(undefined, '2026-03-15', '2026-03-16')).toBe('overdue');
  });

  it('creates pending cash-flow rows for months the member owes', () => {
    const db = emptyDb({
      members: [
        member({
          id: 'm1',
          name: 'Ana Souza',
          joinedAt: '2026-05-10',
          monthlyFee: 55,
        }),
      ],
    });
    const created = syncMensalidades(db, 2026, 'u1', '2026-05-01');
    expect(created).toBe(7);
    expect(db.movementTypes.some((type) => type.name === 'Mensalidade')).toBe(true);
    expect(db.transactions.every((tx) => tx.paymentStatus === 'pending' && tx.memberId === 'm1')).toBe(true);
    expect(db.transactions[0].date).toBe('2026-05-10');
    expect(db.transactions[0].amount).toBe(89.5);
    expect(syncMensalidades(db, 2026, 'u1', '2026-05-01')).toBe(0);
  });

  it('keeps paid months and hides months before the member joined', () => {
    const movement: MovementType = {
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
    const paid: Transaction = {
      id: 't1',
      date: '2026-05-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-men',
      description: 'Mensalidade maio',
      amount: 55,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'paid',
      memberId: 'm1',
      origin: 'sicredi',
      createdAt: '2026-05-10T00:00:00.000Z',
    };
    const db = emptyDb({
      members: [
        member({
          id: 'm1',
          name: 'Ana Souza',
          joinedAt: '2026-05-10',
          monthlyFee: 55,
        }),
      ],
      movementTypes: [movement],
      transactions: [paid],
    });
    const report = buildMensalidadeReport(db, 2026, '2026-06-11');
    const cells = report.rows[0].cells;
    expect(cells.find((cell) => cell.month === 3)?.status).toBe('none');
    expect(cells.find((cell) => cell.month === 5)?.status).toBe('paid');
    expect(cells.find((cell) => cell.month === 6)?.status).toBe('overdue');
    expect(cells.find((cell) => cell.month === 7)?.status).toBe('pending');
  });

  it('stops charging months after the member is inactivated', () => {
    expect(nextMonthStart('2026-06-11')).toBe('2026-07-01');
    expect(nextMonthStart('2026-12-20')).toBe('2027-01-01');

    const db = emptyDb({
      members: [
        member({
          id: 'm1',
          name: 'Ana Souza',
          joinedAt: '2026-03-10',
          monthlyFee: 55,
        }),
      ],
    });
    syncMensalidades(db, 2026, 'u1');
    expect(db.transactions).toHaveLength(9);

    db.members[0].status = 'inactive';
    expect(cancelSubsequentMensalidades(db, 'm1', '2026-06-11')).toBe(5);
    expect(db.transactions.map((tx) => tx.date.slice(5, 7))).toEqual(['03', '04', '05', '06']);

    const report = buildMensalidadeReport(db, 2026, '2026-06-11');
    const cells = report.rows[0].cells;
    expect(cells.find((cell) => cell.month === 6)?.status).toBe('overdue');
    expect(cells.find((cell) => cell.month === 7)?.status).toBe('none');
    expect(cells.find((cell) => cell.month === 12)).toBeUndefined();
    expect(syncMensalidades(db, 2026, 'u1', '2026-06-11')).toBe(0);
    expect(db.transactions).toHaveLength(4);
  });

  it('updates member fees and pending mensalidades to the official table', () => {
    const db = emptyDb({
      members: [
        member({
          id: 'm1',
          name: 'Ana Souza',
          joinedAt: '2026-03-10',
          monthlyFee: 55,
        }),
      ],
    });
    syncMensalidades(db, 2026, 'u1', '2026-03-01');
    const march = db.transactions.find((tx) => tx.date.startsWith('2026-03'))!;
    const april = db.transactions.find((tx) => tx.date.startsWith('2026-04'))!;
    const may = db.transactions.find((tx) => tx.date.startsWith('2026-05'))!;
    march.paymentStatus = 'paid';
    applyMensalidadeFee(db, 55, 70, 'u1', '2026-03-01');
    expect(db.members[0].monthlyFee).toBe(89.5);
    expect(march.amount).toBe(60);
    expect(april.amount).toBe(60);
    expect(may.amount).toBe(89.5);
    expect(
      db.transactions
        .filter((tx) => tx.paymentStatus === 'pending' && tx.date.slice(5, 7) >= '05')
        .every((tx) => tx.amount === 89.5),
    ).toBe(true);
  });

  it('raises pending amounts after the 10th for non-members from maio', () => {
    const db = emptyDb({
      members: [
        member({
          id: 'm1',
          name: 'Ana Souza',
          joinedAt: '2026-03-01',
          monthlyFee: 55,
          clubeLtc: false,
        }),
      ],
    });
    syncMensalidades(db, 2026, 'u1', '2026-03-10');
    expect(db.transactions.find((tx) => tx.date === '2026-03-10')?.amount).toBe(60);
    expect(db.transactions.find((tx) => tx.date === '2026-04-10')?.amount).toBe(60);
    expect(db.transactions.find((tx) => tx.date === '2026-05-10')?.amount).toBe(89.5);
    syncMensalidades(db, 2026, 'u1', '2026-05-11');
    expect(db.transactions.find((tx) => tx.date === '2026-03-10')?.amount).toBe(60);
    expect(db.transactions.find((tx) => tx.date === '2026-05-10')?.amount).toBe(99.5);
    expect(db.transactions.find((tx) => tx.date === '2026-06-10')?.amount).toBe(89.5);
  });

  it('does not charge dirigentes, escotistas or Clube da Flor de Lis', () => {
    const movement: MovementType = {
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
    const pending: Transaction = {
      id: 't-open',
      date: '2026-04-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-men',
      description: 'Mensalidade abril',
      amount: 89.5,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'pending',
      memberId: 'm2',
      origin: 'manual',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    const paid: Transaction = {
      id: 't-paid',
      date: '2026-03-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-men',
      description: 'Mensalidade março',
      amount: 89.5,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'paid',
      memberId: 'm2',
      origin: 'manual',
      createdAt: '2026-03-10T00:00:00.000Z',
    };
    const db = emptyDb({
      members: [
        member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-01', role: 'jovem' }),
        member({ id: 'm2', name: 'Bia Lima', joinedAt: '2026-03-01', role: 'escotista' }),
        member({ id: 'm3', name: 'Caio Dias', joinedAt: '2026-03-01', role: 'dirigente', branch: 'senior' }),
        member({ id: 'm4', name: 'Duda Nunes', joinedAt: '2026-03-01', role: 'clube', branch: 'flor-de-lis' }),
      ],
      movementTypes: [movement],
      transactions: [pending, paid],
    });
    syncMensalidades(db, 2026, 'u1', '2026-03-01');
    expect(db.members.find((item) => item.id === 'm2')?.monthlyFee).toBe(0);
    expect(db.members.find((item) => item.id === 'm3')?.monthlyFee).toBe(0);
    expect(db.members.find((item) => item.id === 'm4')?.monthlyFee).toBe(0);
    expect(db.transactions.filter((tx) => tx.memberId === 'm2')).toEqual([paid]);
    expect(db.transactions.some((tx) => tx.memberId === 'm3' || tx.memberId === 'm4')).toBe(false);
    expect(db.transactions.some((tx) => tx.memberId === 'm1' && tx.paymentStatus === 'pending')).toBe(true);
    const report = buildMensalidadeReport(db, 2026, '2026-03-01');
    expect(report.rows.map((row) => row.memberId)).toEqual(['m1']);
  });

  it('uses the due day stored in settings for pending rows', () => {
    const db = emptyDb({
      members: [
        member({
          id: 'm1',
          name: 'Ana Souza',
          joinedAt: '2026-03-01',
          monthlyFee: 55,
        }),
      ],
      settings: { openingBalance: 0, groupName: 'Arno', mensalidadeDueDay: 15 },
    });
    syncMensalidades(db, 2026, 'u1', '2026-03-01');
    expect(db.transactions[0].date).toBe('2026-03-15');
    db.settings.mensalidadeDueDay = 20;
    syncMensalidades(db, 2026, 'u1', '2026-03-01');
    expect(db.transactions.every((tx) => tx.date.endsWith('-20'))).toBe(true);
  });

  it('toggles club fee on a pending month and in bulk', () => {
    const db = emptyDb({
      members: [
        member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-01' }),
        member({ id: 'm2', name: 'Bia Lima', joinedAt: '2026-03-01' }),
      ],
    });
    syncMensalidades(db, 2026, 'u1', '2026-03-01');
    const april = db.transactions.find((tx) => tx.memberId === 'm1' && tx.date.startsWith('2026-04'));
    expect(april?.amount).toBe(60);
    setMensalidadeClubFee(db, april!.id, false, 'u1', '2026-03-01');
    expect(april?.clubFeeIncluded).toBe(false);
    expect(april?.amount).toBe(60);
    const may = db.transactions.find((tx) => tx.memberId === 'm1' && tx.date.startsWith('2026-05'));
    expect(may?.amount).toBe(89.5);
    setMensalidadeClubFee(db, may!.id, false, 'u1', '2026-03-01');
    expect(may?.clubFeeIncluded).toBe(false);
    expect(may?.amount).toBe(69.5);
    const updated = setMensalidadeClubFeeBulk(db, { year: 2026, month: 6, clubFeeIncluded: false }, 'u1', '2026-03-01');
    expect(updated).toBe(2);
    expect(
      db.transactions
        .filter((tx) => tx.date.startsWith('2026-06'))
        .every((tx) => tx.clubFeeIncluded === false && tx.amount === 69.5),
    ).toBe(true);
    const report = buildMensalidadeReport(db, 2026, '2026-03-01');
    const anaMay = report.rows.find((row) => row.memberId === 'm1')?.cells.find((cell) => cell.month === 5);
    expect(anaMay?.clubFeeIncluded).toBe(false);
    expect(anaMay?.amount).toBe(69.5);
  });

  it('applies a member fee override from maio without late bump', () => {
    const db = emptyDb({
      members: [member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-01', feeOverride: 82 })],
    });
    syncMensalidades(db, 2026, 'u1', '2026-05-11');
    expect(db.members[0].monthlyFee).toBe(82);
    expect(db.transactions.find((tx) => tx.date === '2026-03-10')?.amount).toBe(60);
    expect(db.transactions.find((tx) => tx.date === '2026-05-10')?.amount).toBe(82);
    expect(db.transactions.find((tx) => tx.date === '2026-06-10')?.amount).toBe(82);
    const report = buildMensalidadeReport(db, 2026, '2026-05-11');
    expect(report.rows[0].feeOverride).toBe(82);
    expect(report.rows[0].monthlyFee).toBe(82);
    expect(report.rows[0].lateFee).toBe(82);
  });

  it('settles overdue months as on-time or late with a paidAt date', () => {
    const db = emptyDb({
      members: [member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-01' })],
    });
    syncMensalidades(db, 2026, 'u1', '2026-09-20');
    const september = db.transactions.find((tx) => tx.date === '2026-09-10')!;
    expect(september.amount).toBe(99.5);
    expect(mensalidadeAmountForTiming(db.members[0], '2026-09-10', true, 'on_time')).toBe(89.5);
    expect(mensalidadeAmountForTiming(db.members[0], '2026-09-10', true, 'late')).toBe(99.5);

    const onTime = settleMensalidade(
      db,
      { transactionId: september.id, timing: 'on_time', paidAt: '2026-09-08', notifyReceipt: true },
      'u1',
      '2026-09-20',
    );
    expect(onTime?.shouldNotify).toBe(true);
    expect(onTime?.tx.paymentStatus).toBe('paid');
    expect(onTime?.tx.amount).toBe(89.5);
    expect(onTime?.tx.paidAt).toBe('2026-09-08');

    const october = db.transactions.find((tx) => tx.date === '2026-10-10')!;
    const late = settleMensalidade(
      db,
      { transactionId: october.id, timing: 'late', paidAt: '2026-10-15' },
      'u1',
      '2026-10-20',
    );
    expect(late?.tx.amount).toBe(99.5);
    expect(late?.tx.paidAt).toBe('2026-10-15');

    const mayCell = buildMensalidadeReport(db, 2026, '2026-09-20').rows[0].cells.find((cell) => cell.month === 5);
    expect(mayCell?.onTimeAmount).toBe(89.5);
    expect(mayCell?.lateAmount).toBe(99.5);
  });
});
