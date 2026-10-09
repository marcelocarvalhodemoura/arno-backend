import { domainEvents, type DomainEvents } from '../shared/domain/domain-events';
import type { TransactionPaid, TransactionPaymentChanged } from '../ledger/domain/events';
import { dissolveMensalidadeArrearsSplitIfSeparate, registerArrearsInstallmentPaid } from './arrears';

const registered = new WeakSet<DomainEvents>();

/**
 * O acordo de atrasados reage aos pagamentos do caixa: quem lança (caixa, mensalidades, conciliação) só avisa
 * que um lançamento foi pago; quem sabe dar a parcela por quitada é este módulo.
 */
export function registerArrearsEventHandlers(bus: DomainEvents = domainEvents) {
  if (registered.has(bus)) return;
  registered.add(bus);

  bus.on<TransactionPaid>('TransactionPaid', (event, db) => {
    if (!event.arrears) return;
    registerArrearsInstallmentPaid(db, event.arrears.planId, event.arrears.yearMonth, event.userId, {
      source: event.arrears.source,
      transactionId: event.transactionId,
      method: event.method,
      paidAt: event.paidAt,
    });
  });

  // Mensalidade + acordo: se uma parte foi paga e a outra não (ou em datas diferentes), vira lançamentos únicos.
  bus.on<TransactionPaymentChanged>('TransactionPaymentChanged', (event, db) => {
    dissolveMensalidadeArrearsSplitIfSeparate(db, event.transaction, event.userId);
  });
}

registerArrearsEventHandlers();
