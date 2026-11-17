import { getBankSyncState, listBankMovements, saveBankSyncState, upsertBankMovements } from './bank-store';
import { listPluggyTransactions, pluggyStatus, type PluggyTransaction } from './pluggy';
import type { BankMovement, PaymentMethod } from '../shared/types';
import { roundMoney } from '../shared/types';

/** Primeiro e último dia do mês (yyyy-mm). */
export function monthRange(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

export function currentMonth(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}

function pluggyMethod(value?: string | null): PaymentMethod {
  const method = (value ?? '').toUpperCase();
  if (method === 'PIX') return 'pix';
  if (method === 'TED' || method === 'DOC' || method === 'TEF') return 'transfer';
  return 'other';
}

export function pluggyToMovement(tx: PluggyTransaction): Parameters<typeof upsertBankMovements>[0][number] | null {
  const amount = roundMoney(Math.abs(Number(tx.amount)));
  // Lançamento pendente pode mudar de id/valor ao compensar; só entra quando POSTED.
  if (!tx.id || !Number.isFinite(amount) || amount === 0 || tx.status === 'PENDING') return null;
  const income = tx.type === 'CREDIT';
  // Contraparte: quem pagou (entrada) ou quem recebeu (saída).
  const party = income ? tx.paymentData?.payer : tx.paymentData?.receiver;
  // Data de lançamento do banco: o dia vem em UTC meia-noite, não converter para Brasília.
  const date = tx.date.slice(0, 10);
  return {
    provider: 'pluggy',
    externalId: `pluggy:${tx.id}`,
    occurredAt: tx.date,
    date,
    amount,
    type: income ? 'income' : 'expense',
    method: pluggyMethod(tx.paymentData?.paymentMethod),
    description: (tx.descriptionRaw || tx.description || '').replace(/\s+/g, ' ').trim(),
    payerName: party?.name ?? '',
    payerDocument: party?.documentNumber?.value ?? '',
    txid: '',
  };
}

export function summarizeMonth(movements: BankMovement[]) {
  const income = movements.filter((item) => item.type === 'income');
  const expense = movements.filter((item) => item.type === 'expense');
  const totalIncome = roundMoney(income.reduce((sum, item) => sum + item.amount, 0));
  const totalExpense = roundMoney(expense.reduce((sum, item) => sum + item.amount, 0));
  return {
    income: totalIncome,
    expense: totalExpense,
    balance: roundMoney(totalIncome - totalExpense),
    incomeCount: income.length,
    expenseCount: expense.length,
  };
}

export async function pluggyMonth(month: string) {
  const { from, to } = monthRange(month);
  const sync = await getBankSyncState('pluggy');
  const movements = await listBankMovements(from, to, 'pluggy');
  return {
    ...pluggyStatus(),
    month,
    from,
    to,
    lastSyncAt: sync.lastSyncAt,
    lastError: sync.lastError,
    summary: summarizeMonth(movements),
    movements,
  };
}

export async function syncPluggyMonth(month: string) {
  if (!pluggyStatus().configured) throw new Error('Pluggy ainda não está configurado');
  const { from, to } = monthRange(month);
  try {
    const transactions = await listPluggyTransactions(month, from, to);
    const inputs = transactions
      .map(pluggyToMovement)
      .filter((item): item is NonNullable<typeof item> => item !== null && item.date >= from && item.date <= to);
    if (inputs.length) await upsertBankMovements(inputs);
    await saveBankSyncState({
      provider: 'pluggy',
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      lastFrom: from,
      lastTo: to,
    });
    return { ...(await pluggyMonth(month)), fetched: transactions.length, stored: inputs.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao consultar o Pluggy';
    await saveBankSyncState({ provider: 'pluggy', lastError: message, lastFrom: from, lastTo: to });
    throw error;
  }
}
