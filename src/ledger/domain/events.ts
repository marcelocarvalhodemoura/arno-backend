import type { DomainEvent } from '../../shared/domain/domain-events';
import type { PaymentMethod, Transaction } from '../../shared/types';

/** Parcela de acordo de atrasados que um pagamento quita. */
export type ArrearsInstallmentRef = {
  planId: string;
  /** Competência AAAA-MM da parcela. */
  yearMonth: string;
  /** separate: lançamento próprio da parcela; mensalidade: parcela embutida na mensalidade. */
  source: 'separate' | 'mensalidade';
};

/** Um lançamento passou a pago. */
export type TransactionPaid = DomainEvent & {
  type: 'TransactionPaid';
  transactionId: string;
  method: PaymentMethod;
  /** Sem data, quem reage usa hoje. */
  paidAt?: string;
  userId: string;
  arrears?: ArrearsInstallmentRef;
};

/** A situação ou a data de pagamento de um lançamento mudou (pago ↔ pendente, outra data). */
export type TransactionPaymentChanged = DomainEvent & {
  type: 'TransactionPaymentChanged';
  transaction: Transaction;
  userId: string;
};

export function transactionPaid(input: Omit<TransactionPaid, 'type'>): TransactionPaid {
  return { type: 'TransactionPaid', ...input };
}
