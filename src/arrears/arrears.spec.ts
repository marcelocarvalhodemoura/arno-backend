// O acordo de atrasados reage aos pagamentos por eventos de domínio.
import './arrears.events';
import type { DatabaseShape, Member } from '../shared/types';
import { roundMoney } from '../shared/types';
import { createdAudit } from '../shared/audit';
import { updateTransaction } from '../ledger/transactions';
import {
  applyArrearsCashPayment,
  arrearsProgress,
  createArrearsPlan,
  generateArrearsDue,
  installmentForYearMonth,
  planYearMonths,
  registerArrearsInstallmentPaid,
  repairActiveEmbedSplits,
  resolveArrearsTxMarker,
  yearMonthKey,
} from './arrears';

function emptyDb(): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    memberArrears: [],
    movementTypes: [
      {
        id: 'mt-mens',
        name: 'Mensalidade',
        direction: 'income',
        description: '',
        pixKey: '',
        branch: 'grupo',
        active: true,
        ...createdAudit('u1'),
      },
    ],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Teste', mensalidadeDueDay: 10 },
  };
}

function member(partial: Partial<Member> & { id: string; name: string }): Member {
  return {
    email: '',
    phone: '',
    branch: 'escoteiro',
    role: 'jovem',
    monthlyFee: 82,
    status: 'active',
    joinedAt: '2024-01-01',
    clubeLtc: false,
    ...createdAudit('u1'),
    ...partial,
  };
}

describe('arrears', () => {
  it('plans mar–nov calendar skipping off-season months', () => {
    expect(planYearMonths('2026-03', 3)).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(planYearMonths('2026-10', 3)).toEqual(['2026-10', '2026-11', '2027-03']);
  });

  it('creates embed plan and registers installment on settle', () => {
    const db = emptyDb();
    db.members.push(member({ id: 'm1', name: 'Ana' }));
    db.transactions.push({
      id: 't1',
      date: '2026-03-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-mens',
      description: 'Mensalidade março 2026 — Ana',
      amount: 82,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'pending',
      memberId: 'm1',
      ...createdAudit('u1'),
    });

    const plan = createArrearsPlan(
      db,
      {
        memberId: 'm1',
        amount: 120,
        installments: 3,
        startYearMonth: '2026-03',
        chargeMode: 'embed',
      },
      'u1',
    );
    expect(plan.installmentAmount).toBe(40);
    expect(db.transactions[0].amount).toBe(82);
    expect(db.transactions).toHaveLength(2);
    const mens = db.transactions.find((tx) => tx.movementTypeId === 'mt-mens');
    const debt = db.transactions.find((tx) => tx.arrearsYearMonth === '2026-03');
    expect(mens?.amount).toBe(82);
    expect(mens?.splitGroupId).toBeTruthy();
    expect(debt?.amount).toBe(40);
    expect(debt?.arrearsId).toBe(plan.id);
    expect(resolveArrearsTxMarker(db, mens!)).toBe('embed');
    expect(resolveArrearsTxMarker(db, debt!)).toBe('agreement');

    expect(installmentForYearMonth(plan, '2026-03')).toBe(40);
    registerArrearsInstallmentPaid(db, plan.id, '2026-03', 'u1');
    expect(plan.remainingCount).toBe(2);
    expect(plan.balance).toBe(80);
    expect(plan.payments).toHaveLength(1);
    expect(plan.payments?.[0].source).toBe('mensalidade');
    expect(installmentForYearMonth(plan, '2026-03')).toBe(0);
    expect(installmentForYearMonth(plan, '2026-04')).toBe(40);
  });

  it('generates separate due installments retroactively without duplicating', () => {
    const db = emptyDb();
    db.members.push(member({ id: 'm1', name: 'Ana' }));
    const plan = createArrearsPlan(
      db,
      {
        memberId: 'm1',
        amount: 90,
        installments: 3,
        startYearMonth: '2026-03',
        chargeMode: 'separate',
      },
      'u1',
    );
    const first = generateArrearsDue(db, plan.id, '2026-04', 'u1');
    expect(first).toHaveLength(2);
    expect(first[0].arrearsYearMonth).toBe(yearMonthKey(2026, 3));
    expect(first[1].amount).toBe(30);

    const again = generateArrearsDue(db, plan.id, '2026-05', 'u1');
    expect(again).toHaveLength(1);
    expect(again[0].arrearsYearMonth).toBe('2026-05');
  });

  it('registers partial cash payment and tracks progress', () => {
    const db = emptyDb();
    db.members.push(member({ id: 'm1', name: 'Ana' }));
    db.transactions.push({
      id: 't1',
      date: '2026-03-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-mens',
      description: 'Mensalidade março 2026 — Ana',
      amount: 82,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'pending',
      memberId: 'm1',
      ...createdAudit('u1'),
    });
    db.transactions.push({
      id: 't2',
      date: '2026-04-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-mens',
      description: 'Mensalidade abril 2026 — Ana',
      amount: 82,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'pending',
      memberId: 'm1',
      ...createdAudit('u1'),
    });

    const plan = createArrearsPlan(
      db,
      {
        memberId: 'm1',
        amount: 500,
        installments: 5,
        startYearMonth: '2026-03',
        chargeMode: 'embed',
      },
      'u1',
    );
    expect(db.transactions.filter((tx) => tx.splitGroupId)).toHaveLength(4); // 2 meses × 2 partes
    expect(db.transactions.find((tx) => tx.id === 't1')?.amount).toBe(82);
    expect(db.transactions.some((tx) => tx.arrearsYearMonth === '2026-03' && tx.amount === 100)).toBe(true);

    const { plan: after, transaction } = applyArrearsCashPayment(
      db,
      plan.id,
      { amount: 200, paidAt: '2026-03-20', note: 'adiantamento' },
      'u1',
    );
    expect(transaction.paymentStatus).toBe('paid');
    expect(transaction.arrearsId).toBe(plan.id);
    expect(after.balance).toBe(300);
    expect(after.remainingCount).toBe(3);
    expect(after.payments).toHaveLength(1);
    expect(after.payments?.[0].source).toBe('manual');
    expect(installmentForYearMonth(after, '2026-03')).toBe(0);
    expect(installmentForYearMonth(after, '2026-04')).toBe(0);
    expect(installmentForYearMonth(after, '2026-05')).toBe(100);
    expect(db.transactions.find((tx) => tx.id === 't1')?.amount).toBe(82);
    expect(db.transactions.find((tx) => tx.id === 't2')?.amount).toBe(82);
    expect(db.transactions.some((tx) => tx.arrearsYearMonth === '2026-03')).toBe(false);
    expect(db.transactions.some((tx) => tx.arrearsYearMonth === '2026-04')).toBe(false);

    const progress = arrearsProgress(after);
    expect(progress.paidTotal).toBe(200);
    expect(progress.percentPaid).toBe(40);
  });

  it('settles remaining balance with cash payment', () => {
    const db = emptyDb();
    db.members.push(member({ id: 'm1', name: 'Ana' }));
    const plan = createArrearsPlan(
      db,
      {
        memberId: 'm1',
        amount: 500,
        installments: 5,
        startYearMonth: '2026-03',
        chargeMode: 'separate',
      },
      'u1',
    );
    applyArrearsCashPayment(db, plan.id, { amount: 100 }, 'u1');
    const { plan: settled } = applyArrearsCashPayment(db, plan.id, { amount: 400 }, 'u1');
    expect(settled.status).toBe('settled');
    expect(settled.balance).toBe(0);
    expect(settled.payments).toHaveLength(2);
    expect(arrearsProgress(settled).percentPaid).toBe(100);
  });

  it('marks cash-flow indicators for embed vs agreement launches', () => {
    const db = emptyDb();
    db.members.push(member({ id: 'm1', name: 'Ana' }));
    db.transactions.push({
      id: 't1',
      date: '2026-03-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-mens',
      description: 'Mensalidade março 2026 — Ana',
      amount: 82,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'pending',
      memberId: 'm1',
      ...createdAudit('u1'),
    });
    const plan = createArrearsPlan(
      db,
      {
        memberId: 'm1',
        amount: 200,
        installments: 2,
        startYearMonth: '2026-03',
        chargeMode: 'embed',
      },
      'u1',
    );
    expect(
      resolveArrearsTxMarker(
        db,
        db.transactions.find((tx) => tx.movementTypeId === 'mt-mens')!,
      ),
    ).toBe('embed');

    const { transaction } = applyArrearsCashPayment(db, plan.id, { amount: 50 }, 'u1');
    expect(resolveArrearsTxMarker(db, transaction)).toBe('agreement');
  });

  it('repairs legacy combined amounts without creating a new plan', () => {
    const db = emptyDb();
    db.members.push(member({ id: 'm1', name: 'Ana', monthlyFee: 89.5 }));
    db.transactions.push({
      id: 't1',
      date: '2026-03-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-mens',
      description: 'Mensalidade março 2026 — Ana',
      amount: 160,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'pending',
      memberId: 'm1',
      clubFeeIncluded: true,
      ...createdAudit('u1'),
    });
    db.memberArrears = [
      {
        id: 'p1',
        memberId: 'm1',
        originalAmount: 500,
        balance: 500,
        installmentAmount: 100,
        totalCount: 5,
        remainingCount: 5,
        startYearMonth: '2026-03',
        chargeMode: 'embed',
        note: '',
        status: 'active',
        ...createdAudit('u1'),
      },
    ];
    expect(repairActiveEmbedSplits(db, 'u1')).toBeGreaterThan(0);
    const mens = db.transactions.find((tx) => tx.id === 't1');
    const debt = db.transactions.find((tx) => tx.arrearsYearMonth === '2026-03');
    expect(mens?.splitGroupId).toBeTruthy();
    expect(debt?.amount).toBe(100);
    expect(roundMoney((mens?.amount ?? 0) + (debt?.amount ?? 0))).toBe(mens?.splitTotal);
  });

  it('dissolves mensalidade+acordo rateio when only mensalidade is paid', () => {
    const db = emptyDb();
    db.members.push(member({ id: 'm1', name: 'Ana', monthlyFee: 89.5 }));
    db.transactions.push({
      id: 't1',
      date: '2026-03-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-mens',
      description: 'Mensalidade março 2026 — Ana',
      amount: 60,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'pending',
      memberId: 'm1',
      clubFeeIncluded: true,
      ...createdAudit('u1'),
    });
    createArrearsPlan(
      db,
      {
        memberId: 'm1',
        amount: 200,
        installments: 2,
        startYearMonth: '2026-03',
        chargeMode: 'embed',
      },
      'u1',
    );
    const mens = db.transactions.find((tx) => tx.movementTypeId === 'mt-mens' && tx.date.startsWith('2026-03'))!;
    const debt = db.transactions.find((tx) => tx.arrearsYearMonth === '2026-03')!;
    expect(mens.splitGroupId).toBeTruthy();
    expect(debt.splitGroupId).toBe(mens.splitGroupId);

    updateTransaction(db, mens.id, { paymentStatus: 'paid', paidAt: '2026-03-15' }, 'u1');
    expect(mens.paymentStatus).toBe('paid');
    expect(mens.splitGroupId).toBeUndefined();
    expect(debt.paymentStatus).toBe('pending');
    expect(debt.splitGroupId).toBeUndefined();

    updateTransaction(db, debt.id, { paymentStatus: 'paid', paidAt: '2026-04-02' }, 'u1');
    expect(debt.paymentStatus).toBe('paid');
    expect(debt.splitGroupId).toBeUndefined();
    expect(mens.splitGroupId).toBeUndefined();
  });
});
