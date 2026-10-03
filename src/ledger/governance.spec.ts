import { createdAudit, updatedAudit } from '../shared/audit';
import type { DatabaseShape, Member, Transaction } from '../shared/types';
import {
  assertClosedMonthsUntouched,
  closeMonth,
  diffTransactions,
  purgeTrash,
  reopenMonth,
  restoreTransaction,
  trashTransaction,
} from './governance';
import { findDuplicateGroups, resolveDuplicate } from './duplicates';
import { confirmReconciliation, reconciliationSuggestions } from '../mensalidades/reconciliation';
import {
  isMensalidadeYearGenerated,
  previewGenerateMensalidades,
  syncMensalidades,
} from '../mensalidades/mensalidades';
import { memberProfile, nextSteps } from '../mensalidades/overview';

function db(partial: Partial<DatabaseShape> = {}): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [
      {
        id: 'mens',
        name: 'Mensalidade',
        direction: 'income',
        description: '',
        pixKey: '',
        branch: 'grupo',
        active: true,
        ...createdAudit('u1'),
      },
      {
        id: 'idf',
        name: 'A identificar',
        direction: 'both',
        description: '',
        pixKey: '',
        branch: 'grupo',
        active: true,
        ...createdAudit('u1'),
      },
      {
        id: 'loja',
        name: 'Loja',
        direction: 'both',
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
    trash: [],
    monthClosings: [],
    settings: { openingBalance: 100, groupName: 'Arno', mensalidadeDueDay: 10 },
    ...partial,
  };
}

function tx(partial: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction {
  return {
    date: '2026-08-14',
    type: 'income',
    nature: 'variable',
    movementTypeId: 'loja',
    description: 'Cantina do sábado',
    amount: 120,
    branch: 'grupo',
    method: 'pix',
    paymentStatus: 'paid',
    paidAt: '2026-08-14',
    ...createdAudit('u1'),
    ...partial,
  };
}

const snapshot = (store: DatabaseShape) => new Map(store.transactions.map((item) => [item.id, structuredClone(item)]));

describe('lixeira', () => {
  it('exclui para a lixeira, restaura e expira em 30 dias', () => {
    const store = db({ transactions: [tx({ id: 't1' })] });
    const entry = trashTransaction(store, 't1', 'u1', new Date('2026-09-01T10:00:00Z'))!;
    expect(store.transactions).toHaveLength(0);
    expect(store.trash).toHaveLength(1);

    restoreTransaction(store, entry.id);
    expect(store.transactions.map((item) => item.id)).toEqual(['t1']);
    expect(store.trash).toHaveLength(0);

    trashTransaction(store, 't1', 'u1', new Date('2026-09-01T10:00:00Z'));
    expect(purgeTrash(store, new Date('2026-09-20T10:00:00Z'))).toHaveLength(0);
    expect(purgeTrash(store, new Date('2026-10-02T10:00:00Z'))).toHaveLength(1);
    expect(store.trash).toHaveLength(0);
  });
});

describe('fechamento do mês', () => {
  it('guarda os totais e trava lançamentos pagos do mês', () => {
    const store = db({
      transactions: [
        tx({ id: 'in', amount: 120 }),
        tx({ id: 'out', type: 'expense', amount: 20 }),
        tx({
          id: 'pend',
          movementTypeId: 'mens',
          paymentStatus: 'pending',
          paidAt: undefined,
          amount: 89.5,
          date: '2026-08-10',
        }),
      ],
    });
    const closing = closeMonth(store, '2026-08', 'u1', new Date('2026-10-02T12:00:00Z'));
    expect(closing).toMatchObject({ income: 120, expense: 20, balance: 200 });

    const before = snapshot(store);
    store.transactions.find((item) => item.id === 'in')!.amount = 130;
    expect(() => assertClosedMonthsUntouched(before, store)).toThrow(/agosto\/2026 está fechado/);

    const before2 = snapshot(store);
    store.transactions = store.transactions.filter((item) => item.id !== 'out');
    expect(() => assertClosedMonthsUntouched(before2, store)).toThrow(/fechado/);
  });

  it('permite dar baixa atrasada em cobrança pendente do mês fechado', () => {
    const store = db({
      transactions: [
        tx({ id: 'pend', movementTypeId: 'mens', paymentStatus: 'pending', paidAt: undefined, date: '2026-08-10' }),
      ],
    });
    closeMonth(store, '2026-08', 'u1', new Date('2026-10-02T12:00:00Z'));
    const before = snapshot(store);
    Object.assign(store.transactions[0]!, { paymentStatus: 'paid', paidAt: '2026-10-01' });
    expect(() => assertClosedMonthsUntouched(before, store)).not.toThrow();
  });

  it('não fecha o mês corrente e reabre', () => {
    const store = db();
    expect(() => closeMonth(store, '2026-10', 'u1', new Date('2026-10-02T12:00:00Z'))).toThrow(/já terminaram/);
    closeMonth(store, '2026-09', 'u1', new Date('2026-10-02T12:00:00Z'));
    expect(reopenMonth(store, '2026-09')).toBe(true);
    expect(store.monthClosings).toHaveLength(0);
  });
});

describe('histórico', () => {
  it('registra campos alterados com nomes legíveis, criação e exclusão', () => {
    const store = db({ transactions: [tx({ id: 't1' }), tx({ id: 't2' })] });
    const before = snapshot(store);
    Object.assign(store.transactions[0]!, { amount: 150, movementTypeId: 'mens', ...updatedAudit('u2') });
    trashTransaction(store, 't2', 'u3');
    store.transactions.push(tx({ id: 't3' }));
    const entries = diffTransactions(before, store);
    const updated = entries.find((item) => item.transactionId === 't1')!;
    expect(updated.kind).toBe('updated');
    expect(updated.byId).toBe('u2');
    expect(updated.changes).toEqual(
      expect.arrayContaining([
        { field: 'amount', label: 'Valor', from: '120.00', to: '150.00' },
        { field: 'movementTypeId', label: 'Tipo', from: 'Loja', to: 'Mensalidade' },
      ]),
    );
    expect(entries.find((item) => item.transactionId === 't2')).toMatchObject({ kind: 'deleted', byId: 'u3' });
    expect(entries.find((item) => item.transactionId === 't3')).toMatchObject({ kind: 'created' });
  });
});

describe('possíveis duplicados', () => {
  it('sugere, respeita o descarte e manda a cópia para a lixeira', () => {
    const pix = 'RECEBIMENTO PIX 12345678900 CARLA EXEMPLO PIX_CRED';
    const store = db({
      transactions: [
        tx({ id: 'a', description: pix, origin: 'sicredi', createdAt: '2026-08-14T10:00:00Z' }),
        tx({ id: 'b', description: pix, origin: 'integration', createdAt: '2026-08-15T10:00:00Z' }),
      ],
    });
    const groups = findDuplicateGroups(store, new Set());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.id).toBe('a');
    expect(findDuplicateGroups(store, new Set([groups[0]!.key]))).toHaveLength(0);

    resolveDuplicate(store, 'a', ['b'], 'u1');
    expect(store.transactions.map((item) => item.id)).toEqual(['a']);
    expect(store.trash?.[0]?.transaction.id).toBe('b');
  });
});

const julia: Member = {
  id: 'julia',
  name: 'JÚLIA EXEMPLO',
  email: '',
  phone: '',
  branch: 'escoteiro',
  role: 'jovem',
  status: 'active',
  joinedAt: '2026-03-01',
  monthlyFee: 89.5,
  clubeLtc: false,
  ...createdAudit('u1'),
} as unknown as Member;

describe('grade e conciliação', () => {
  it('não considera gerado um ano sem cobranças e prevê quantas seriam criadas', () => {
    const store = db({ members: [julia] });
    expect(isMensalidadeYearGenerated(store, 2027)).toBe(false);
    expect(previewGenerateMensalidades(store, 2027, '2026-10-02')).toBe(9);
    expect(store.transactions).toHaveLength(0);
  });

  it('sugere a mensalidade pelo responsável e confirma a baixa', () => {
    const store = db({
      members: [julia],
      memberGuardians: [
        { id: 'g1', memberId: 'julia', name: 'CARLA EXEMPLO', relationship: 'Mãe', email: '', phone: '' } as never,
      ],
    });
    syncMensalidades(store, 2026, 'u1', '2026-03-01');
    const may = store.transactions.find((item) => item.date === '2026-05-10')!;
    store.transactions.push(
      tx({
        id: 'pix',
        movementTypeId: 'idf',
        description: 'RECEBIMENTO PIX 12345678900 CARLA EXEMPLO PIX_CRED',
        amount: may.amount,
        date: '2026-05-11',
        paidAt: '2026-05-11',
      }),
    );
    const [item] = reconciliationSuggestions(store, { from: '2026-05-01', to: '2026-05-31' }, new Set(), '2026-05-11');
    expect(item!.suggestion).toMatchObject({ pendingId: may.id, memberId: 'julia', yearMonth: '2026-05' });
    expect(item!.reason).toMatch(/responsável/);

    const credit = confirmReconciliation(store, 'pix', may.id, 'u1');
    expect(credit).toMatchObject({
      movementTypeId: 'mens',
      memberId: 'julia',
      date: '2026-05-10',
      paidAt: '2026-05-11',
    });
    expect(store.transactions.some((item) => item.id === may.id)).toBe(false);

    const profile = memberProfile(store, 'julia', '2026-06-20');
    expect(profile.grade?.cells.find((cell) => cell.month === 5)?.status).toBe('paid');
    expect(profile.open.map((open) => open.yearMonth)[0]).toBe('2026-03');

    const steps = nextSteps(store, { duplicates: 0, suggestions: 0, sicrediConfigured: false }, '2026-06-20');
    expect(steps.overdue.count).toBe(3);
    expect(steps.closing).toEqual({ yearMonth: '2026-05', pending: true });
  });
});
