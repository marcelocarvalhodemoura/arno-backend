import type { MovementType, Transaction } from '../../shared/types';
import type { TransactionPaid } from './events';
import { LedgerEntry } from './ledger-entry';

const movement = (overrides: Partial<MovementType> = {}): MovementType =>
  ({
    id: 'mt-1',
    name: 'Doação',
    direction: 'income',
    description: '',
    pixKey: '',
    branch: 'grupo',
    active: true,
    origin: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as MovementType;

const fields = {
  date: '2026-05-10',
  type: 'income' as const,
  nature: 'variable' as const,
  movementTypeId: 'mt-1',
  description: 'Doação',
  amount: 10.005,
  branch: 'grupo' as const,
  method: 'pix' as const,
};

describe('LedgerEntry', () => {
  it('abre pago por padrão, arredonda o valor e carimba o pagamento no vencimento', () => {
    const entry = LedgerEntry.open(fields, movement(), {}, 'u-1');
    expect(entry.tx).toMatchObject({ paymentStatus: 'paid', paidAt: '2026-05-10', amount: 10.01, createdBy: 'u-1' });
    expect(entry.pullEvents()).toEqual([]);
  });

  it('recusa tipo inativo ou de outra direção', () => {
    expect(() => LedgerEntry.open(fields, movement({ active: false }), {}, 'u')).toThrow(
      'Tipo de movimentação inválido',
    );
    expect(() => LedgerEntry.open(fields, undefined, {}, 'u')).toThrow('Tipo de movimentação inválido');
    expect(() => LedgerEntry.open(fields, movement({ direction: 'expense' }), {}, 'u')).toThrow(
      'Este tipo não aceita essa direção (entrada/saída)',
    );
  });

  it('só valida o tipo quando ele muda', () => {
    const entry = LedgerEntry.open(fields, movement(), {}, 'u');
    expect(() => entry.changeKind('income', movement({ active: false }))).not.toThrow();
    expect(() => entry.changeKind('income', movement({ id: 'mt-2', active: false }))).toThrow('Este tipo está inativo');
    expect(() => entry.changeKind('expense', movement())).toThrow('Troque o tipo ou a direção');
  });

  it('avisa quando vira pago, com a parcela do acordo quando houver', () => {
    const tx = {
      ...LedgerEntry.open(fields, movement(), { status: 'pending' }, 'u').tx,
      arrearsId: 'plan-1',
      arrearsYearMonth: '2026-05',
    } as Transaction;
    const entry = LedgerEntry.of(tx);
    entry.changePayment(movement(), 'paid', '2026-05-12', 'u-2');
    const [paid, changed] = entry.pullEvents();
    expect(paid).toEqual<TransactionPaid>({
      type: 'TransactionPaid',
      transactionId: tx.id,
      method: 'pix',
      paidAt: '2026-05-12',
      userId: 'u-2',
      arrears: { planId: 'plan-1', yearMonth: '2026-05', source: 'separate' },
    });
    expect(changed.type).toBe('TransactionPaymentChanged');
    expect(entry.pullEvents()).toEqual([]);
  });

  it('pagar de novo um pago não gera TransactionPaid; voltar para pendente limpa a data', () => {
    const entry = LedgerEntry.open(fields, movement(), {}, 'u');
    entry.changePayment(movement(), 'paid', '2026-05-20', 'u');
    expect(entry.pullEvents().map((event) => event.type)).toEqual(['TransactionPaymentChanged']);
    entry.changePayment(movement(), 'pending', undefined, 'u');
    expect(entry.tx.paidAt).toBeUndefined();
  });

  it('vincula e desvincula associado, conta e projeto', () => {
    const entry = LedgerEntry.open(fields, movement(), {}, 'u');
    entry.assign('memberId', 'm-1');
    entry.assign('projectId', undefined);
    expect(entry.tx.memberId).toBe('m-1');
    entry.assign('memberId', null);
    expect(entry.tx.memberId).toBeUndefined();
  });
});
