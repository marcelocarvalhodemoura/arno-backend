import {
  ALLOCATION_PART_KEYS,
  buildConference,
  computeAllocation,
  describeAllocation,
  groupCashOf,
  partsTotal,
  syncAllocations,
} from './allocations';
import { DEFAULT_FEE_SCHEDULE, mensalidadeFormula } from '../mensalidades/fee-table';
import { buildSnackFundPreview } from '../snack-fund/snack-fund';
import { amountForBranchView } from '../reports/finance';
import type { DatabaseShape, Member, MovementType, Transaction, YouthBranchId } from '../shared/types';
import { roundMoney } from '../shared/types';

function member(partial: Partial<Member> & Pick<Member, 'id'>): Member {
  return {
    name: `Jovem ${partial.id}`,
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
    feeSchedule: structuredClone(DEFAULT_FEE_SCHEDULE),
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
    branch: 'escoteiro',
    method: 'pix',
    paymentStatus: 'paid',
    origin: 'manual',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...partial,
  };
}

const NOW = '2026-10-27T12:00:00.000Z';

describe('allocations', () => {
  it('splits a paid on-time mensalidade into every destination and the parts add up to what was received', () => {
    const db = emptyDb({
      members: [member({ id: 'm1' })],
      transactions: [
        mensalidadeTx({ id: 't1', memberId: 'm1', date: '2026-05-10', paidAt: '2026-05-08', amount: 89.5 }),
      ],
    });
    const allocation = computeAllocation(db, db.transactions[0], NOW)!;
    expect(allocation).toMatchObject({
      periodStart: '2026-05',
      source: 'table',
      late: false,
      clubFeeIncluded: true,
      group: 43,
      branch: 8,
      snack: 24,
      club: 10,
      dilution: 4.5,
      lateFee: 0,
      arrears: 0,
      expected: 89.5,
      received: 89.5,
      difference: 0,
    });
    expect(groupCashOf(allocation)).toBe(47.5);
    expect(describeAllocation(allocation)).toBe(
      'R$ 89,50 = 43,00 operacional + 8,00 caixinha do ramo + 24,00 lanche + 10,00 clube (no prazo) + 4,50 diluição dez/jan/fev (composição de 2026-05, tabela, não sócio)',
    );
  });

  it('reads late from the amount charged, not only from the dates', () => {
    const db = emptyDb({
      members: [member({ id: 'm1' })],
      transactions: [
        // Pago depois do vencimento, mas cobrado no prazo (tolerância): o clube recebe 10, não 20.
        mensalidadeTx({ id: 'grace', memberId: 'm1', date: '2026-06-10', paidAt: '2026-06-12', amount: 89.5 }),
        mensalidadeTx({ id: 'late', memberId: 'm1', date: '2026-07-10', paidAt: '2026-07-15', amount: 99.5 }),
      ],
    });
    syncAllocations(db, NOW);
    const [grace, late] = db.allocations!;
    expect(grace).toMatchObject({ late: false, club: 10, difference: 0 });
    expect(late).toMatchObject({ late: true, club: 20, expected: 99.5, difference: 0 });
  });

  it('flags a payment different from the table instead of hiding it', () => {
    const db = emptyDb({
      members: [member({ id: 'm1' })],
      transactions: [mensalidadeTx({ id: 't1', memberId: 'm1', date: '2026-05-10', paidAt: '2026-05-08', amount: 50 })],
    });
    syncAllocations(db, NOW);
    expect(db.allocations![0]).toMatchObject({ expected: 89.5, received: 50, difference: -39.5 });
    const report = buildConference(db, 2026);
    expect(report.counts.difference).toBe(1);
    expect(report.issues[0].message).toBe('Recebido R$ 50,00, esperado R$ 89,50: R$ 39,50 a menos.');
    expect(report.totals).toMatchObject({ received: 50, snack: 24, difference: -39.5 });
  });

  it('keeps the stored split when the fee schedule changes later and reports the drift', () => {
    const db = emptyDb({
      members: [member({ id: 'm1' })],
      transactions: [
        mensalidadeTx({ id: 't1', memberId: 'm1', date: '2026-05-10', paidAt: '2026-05-08', amount: 89.5 }),
      ],
    });
    syncAllocations(db, NOW);
    db.feeSchedule![1].regular = { ...db.feeSchedule![1].regular, snack: 20, group: 47 };

    expect(syncAllocations(db, NOW)).toEqual({ computed: 0, removed: 0 });
    expect(db.allocations![0]).toMatchObject({ group: 43, snack: 24 });
    expect(buildSnackFundPreview(db, 2026, 5).collected).toBe(24);

    const report = buildConference(db, 2026);
    expect(report.counts.drift).toBe(1);
    expect(report.issues[0].current).toMatchObject({ group: 47, snack: 20 });
  });

  it('keeps the stored split when the member changes branch later', () => {
    const scout = member({ id: 'm1' });
    const db = emptyDb({
      members: [scout],
      transactions: [
        mensalidadeTx({ id: 't1', memberId: 'm1', date: '2026-05-10', paidAt: '2026-05-08', amount: 89.5 }),
      ],
    });
    syncAllocations(db, NOW);
    scout.branch = 'pioneiro';
    syncAllocations(db, NOW);
    expect(db.allocations![0]).toMatchObject({ memberBranch: 'escoteiro', branch: 8, snack: 24 });
    expect(amountForBranchView(db, db.transactions[0])).toBe(8);
  });

  it('recomputes when the transaction itself changes and drops it when it is no longer paid', () => {
    const db = emptyDb({
      members: [member({ id: 'm1' })],
      transactions: [mensalidadeTx({ id: 't1', memberId: 'm1', date: '2026-05-10', paidAt: '2026-05-08', amount: 50 })],
    });
    syncAllocations(db, NOW);
    db.transactions[0].amount = 89.5;
    expect(syncAllocations(db, NOW)).toEqual({ computed: 1, removed: 0 });
    expect(db.allocations![0].difference).toBe(0);

    db.transactions[0].paymentStatus = 'pending';
    expect(syncAllocations(db, NOW)).toEqual({ computed: 0, removed: 1 });
    expect(db.allocations).toEqual([]);
  });

  it('separates an arrears installment paid inside the mensalidade (legacy, no split)', () => {
    const db = emptyDb({
      members: [member({ id: 'm1' })],
      memberArrears: [
        {
          id: 'plan',
          memberId: 'm1',
          originalAmount: 100,
          balance: 80,
          installmentAmount: 20,
          totalCount: 5,
          remainingCount: 4,
          startYearMonth: '2026-05',
          chargeMode: 'embed',
          note: '',
          status: 'active',
          payments: [
            {
              id: 'p1',
              amount: 20,
              paidAt: '2026-05-08',
              method: 'pix',
              source: 'mensalidade',
              transactionId: 't1',
              createdAt: NOW,
            },
          ],
          origin: 'manual',
          createdAt: NOW,
        },
      ],
      transactions: [
        mensalidadeTx({
          id: 't1',
          memberId: 'm1',
          date: '2026-05-10',
          paidAt: '2026-05-08',
          amount: 109.5,
          arrearsId: 'plan',
        }),
      ],
    });
    syncAllocations(db, NOW);
    expect(db.allocations![0]).toMatchObject({ arrears: 20, expected: 109.5, difference: 0 });
    expect(groupCashOf(db.allocations![0])).toBe(67.5);
  });

  it('lists a paid mensalidade without member as unlinked and ignores non-paying roles', () => {
    const db = emptyDb({
      members: [member({ id: 'chefe', role: 'escotista' })],
      transactions: [
        mensalidadeTx({ id: 'orphan', memberId: undefined, date: '2026-05-10', amount: 89.5 }),
        mensalidadeTx({ id: 'chief', memberId: 'chefe', date: '2026-05-10', amount: 89.5 }),
      ],
    });
    syncAllocations(db, NOW);
    expect(db.allocations).toEqual([]);
    const report = buildConference(db, 2026);
    expect(report.counts.unlinked).toBe(1);
    expect(report.issues.map((issue) => issue.transactionId)).toEqual(['orphan']);
  });

  it('marks family special fees as pending split and totals by member branch', () => {
    const db = emptyDb({
      members: [member({ id: 'm1', feeOverride: 82 }), member({ id: 'm2', branch: 'lobinho' })],
      transactions: [
        mensalidadeTx({ id: 't1', memberId: 'm1', date: '2026-05-10', paidAt: '2026-05-08', amount: 82 }),
        mensalidadeTx({ id: 't2', memberId: 'm2', date: '2026-05-10', paidAt: '2026-05-08', amount: 89.5 }),
      ],
    });
    syncAllocations(db, NOW);
    const report = buildConference(db, 2026);
    expect(report.counts.pending_split).toBe(1);
    expect(report.byBranch.map((row) => [row.memberBranch, row.branch, row.received])).toEqual([
      ['escoteiro', 8, 82],
      ['lobinho', 8, 89.5],
    ]);
  });

  describe('the parts always add up to the formula total', () => {
    const branches: YouthBranchId[] = ['filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro'];
    const months = ['2026-03-10', '2026-04-10', '2026-05-10', '2026-08-10', '2026-11-10'];
    const profiles = branches.flatMap((branch) =>
      [false, true].flatMap((clubeLtc) =>
        [null, 82, 67.5, 60].map((feeOverride) => ({ branch, clubeLtc, feeOverride })),
      ),
    );

    it.each(profiles)('%o', (profile) => {
      for (const dueDate of months) {
        for (const late of [false, true]) {
          for (const clubFeeIncluded of [false, true]) {
            const subject = member({ id: 'x', ...profile });
            const formula = mensalidadeFormula(subject, dueDate, { late, clubFeeIncluded }, DEFAULT_FEE_SCHEDULE);
            const db = emptyDb({
              members: [subject],
              transactions: [
                mensalidadeTx({
                  id: 't',
                  memberId: 'x',
                  date: dueDate,
                  paidAt: late ? '2026-12-31' : dueDate,
                  amount: formula.total,
                  clubFeeIncluded,
                }),
              ],
            });
            const allocation = computeAllocation(db, db.transactions[0], NOW)!;
            expect(partsTotal(allocation)).toBe(allocation.expected);
            expect(allocation.difference).toBe(0);
            expect(ALLOCATION_PART_KEYS.every((key) => allocation[key] >= 0)).toBe(true);
            expect(roundMoney(groupCashOf(allocation) + allocation.branch + allocation.snack + allocation.club)).toBe(
              allocation.received,
            );
          }
        }
      }
    });
  });
});
