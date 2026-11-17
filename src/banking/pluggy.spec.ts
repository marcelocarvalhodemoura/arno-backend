import { mockPluggyTransactions, type PluggyTransaction } from './pluggy';
import { monthRange, pluggyToMovement, summarizeMonth } from './pluggy-sync';
import type { BankMovement } from '../shared/types';

function movements(month: string): BankMovement[] {
  return mockPluggyTransactions(month)
    .map(pluggyToMovement)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map((item, index) => ({ ...item, id: `bm-${index}`, status: 'new', createdAt: '2026-09-01T00:00:00.000Z' }));
}

describe('Pluggy (Open Finance)', () => {
  it('calcula o último dia do mês, inclusive fevereiro bissexto', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('converte crédito em entrada com o pagador', () => {
    const movement = pluggyToMovement(mockPluggyTransactions('2026-09')[0]);
    expect(movement).toMatchObject({
      provider: 'pluggy',
      externalId: 'pluggy:mock-2026-09-1',
      date: '2026-09-05',
      amount: 55,
      type: 'income',
      method: 'pix',
      payerName: 'Helena Souza',
      payerDocument: '11144477735',
    });
  });

  it('converte débito em saída positiva com o recebedor', () => {
    const movement = pluggyToMovement(mockPluggyTransactions('2026-09')[2]);
    expect(movement).toMatchObject({
      amount: 89.9,
      type: 'expense',
      payerName: 'Loja Aventura Ltda',
    });
  });

  it('mantém o dia do lançamento sem converter fuso', () => {
    const tx: PluggyTransaction = {
      id: 't1',
      date: '2026-10-01T00:00:00.000Z',
      description: 'TARIFA',
      amount: -10,
      type: 'DEBIT',
    };
    expect(pluggyToMovement(tx)?.date).toBe('2026-10-01');
  });

  it('ignora lançamento pendente ou zerado', () => {
    const base: PluggyTransaction = { id: 't', date: '2026-09-01', description: 'X', amount: 10, type: 'CREDIT' };
    expect(pluggyToMovement({ ...base, status: 'PENDING' })).toBeNull();
    expect(pluggyToMovement({ ...base, amount: 0 })).toBeNull();
  });

  it('resume entradas, saídas e saldo do mês', () => {
    expect(summarizeMonth(movements('2026-09'))).toEqual({
      income: 205,
      expense: 122.4,
      balance: 82.6,
      incomeCount: 2,
      expenseCount: 2,
    });
  });
});
