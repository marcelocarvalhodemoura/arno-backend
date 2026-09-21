import {
  applyMensalidadeFee,
  buildMensalidadeReport,
  cancelSubsequentMensalidades,
  cellStatus,
  dueDateForMonth,
  firstOwedMonth,
  nextMonthStart,
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
      members: [member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-05-10', monthlyFee: 55 })],
    });
    const created = syncMensalidades(db, 2026, 'u1', '2026-05-01');
    expect(created).toBe(8);
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
      members: [member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-05-10', monthlyFee: 55 })],
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
      members: [member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-10', monthlyFee: 55 })],
    });
    syncMensalidades(db, 2026, 'u1');
    expect(db.transactions).toHaveLength(10);

    db.members[0].status = 'inactive';
    expect(cancelSubsequentMensalidades(db, 'm1', '2026-06-11')).toBe(6);
    expect(db.transactions.map((tx) => tx.date.slice(5, 7))).toEqual(['03', '04', '05', '06']);

    const report = buildMensalidadeReport(db, 2026, '2026-06-11');
    const cells = report.rows[0].cells;
    expect(cells.find((cell) => cell.month === 6)?.status).toBe('overdue');
    expect(cells.find((cell) => cell.month === 7)?.status).toBe('none');
    expect(cells.find((cell) => cell.month === 12)?.status).toBe('none');
    expect(syncMensalidades(db, 2026, 'u1', '2026-06-11')).toBe(0);
    expect(db.transactions).toHaveLength(4);
  });

  it('updates member fees and pending mensalidades to the official table', () => {
    const db = emptyDb({
      members: [member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-10', monthlyFee: 55 })],
    });
    syncMensalidades(db, 2026, 'u1', '2026-03-01');
    const paid = db.transactions[0];
    paid.paymentStatus = 'paid';
    applyMensalidadeFee(db, 55, 70, 'u1', '2026-03-01');
    expect(db.members[0].monthlyFee).toBe(89.5);
    expect(paid.amount).toBe(89.5);
    expect(db.transactions.filter((tx) => tx.paymentStatus === 'pending').every((tx) => tx.amount === 89.5)).toBe(true);
  });

  it('raises pending amounts after the 10th for non-members', () => {
    const db = emptyDb({
      members: [member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-01', monthlyFee: 55, clubeLtc: false })],
    });
    syncMensalidades(db, 2026, 'u1', '2026-03-10');
    expect(db.transactions.find((tx) => tx.date === '2026-03-10')?.amount).toBe(89.5);
    syncMensalidades(db, 2026, 'u1', '2026-03-11');
    expect(db.transactions.find((tx) => tx.date === '2026-03-10')?.amount).toBe(99.5);
    expect(db.transactions.find((tx) => tx.date === '2026-04-10')?.amount).toBe(89.5);
  });

  it('uses the due day stored in settings for pending rows', () => {
    const db = emptyDb({
      members: [member({ id: 'm1', name: 'Ana Souza', joinedAt: '2026-03-01', monthlyFee: 55 })],
      settings: { openingBalance: 0, groupName: 'Arno', mensalidadeDueDay: 15 },
    });
    syncMensalidades(db, 2026, 'u1', '2026-03-01');
    expect(db.transactions[0].date).toBe('2026-03-15');
    db.settings.mensalidadeDueDay = 20;
    syncMensalidades(db, 2026, 'u1', '2026-03-01');
    expect(db.transactions.every((tx) => tx.date.endsWith('-20'))).toBe(true);
  });
});
