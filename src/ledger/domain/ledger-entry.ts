import { createdAudit, updatedAudit } from '../../shared/audit';
import { todayISO } from '../../shared/dates';
import { BusinessRuleViolation } from '../../shared/domain/errors';
import type { DomainEvent } from '../../shared/domain/domain-events';
import { Money } from '../../shared/domain/money';
import { id } from '../../shared/id';
import type { MovementType, RecordOrigin, Transaction, TxType } from '../../shared/types';
import { isMensalidadeName } from '../../statement/statement';
import { transactionPaid, type TransactionPaymentChanged } from './events';

type Audited = 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'origin';
export type NewEntryFields = Omit<Transaction, Audited | 'paymentStatus' | 'paidAt' | 'amount'> & {
  amount: number;
  origin?: RecordOrigin;
};

/**
 * Data de pagamento conforme a situação: pendente não tem; pago usa a data informada, mantém a que já tinha ou,
 * na falta, hoje para mensalidade e o vencimento para o resto.
 */
export function stampPaidAt(
  tx: Transaction,
  movementName: string,
  status: Transaction['paymentStatus'],
  paidAt?: string | null,
  today = todayISO(),
) {
  tx.paymentStatus = status;
  if (status !== 'paid') {
    delete tx.paidAt;
    return;
  }
  if (paidAt) {
    tx.paidAt = paidAt;
    return;
  }
  if (tx.paidAt) return;
  tx.paidAt = isMensalidadeName(movementName) ? today : tx.date;
}

/** O tipo de movimentação aceita esta direção (entrada/saída)? */
function acceptsDirection(movement: MovementType, type: TxType) {
  return movement.direction === 'both' || movement.direction === type;
}

/**
 * Lançamento do caixa com as suas regras. Guarda o registro (`tx`) que é persistido e junta os eventos
 * que a mudança provoca; quem grava publica os eventos na mesma transação.
 */
export class LedgerEntry {
  private events: DomainEvent[] = [];

  private constructor(readonly tx: Transaction) {}

  static of(tx: Transaction): LedgerEntry {
    return new LedgerEntry(tx);
  }

  /** Novo lançamento. Pago por padrão, como na tela de lançar. */
  static open(
    fields: NewEntryFields,
    movement: MovementType | undefined,
    payment: { status?: Transaction['paymentStatus']; paidAt?: string | null },
    userId: string,
  ): LedgerEntry {
    if (!movement || !movement.active) throw new BusinessRuleViolation('Tipo de movimentação inválido');
    if (!acceptsDirection(movement, fields.type)) {
      throw new BusinessRuleViolation('Este tipo não aceita essa direção (entrada/saída)');
    }
    const tx: Transaction = {
      id: id(),
      ...fields,
      paymentStatus: payment.status ?? 'paid',
      amount: Money.of(fields.amount).toNumber(),
      ...createdAudit(userId),
    };
    stampPaidAt(tx, movement.name, tx.paymentStatus, payment.paidAt);
    return new LedgerEntry(tx);
  }

  get id() {
    return this.tx.id;
  }

  get isPaid() {
    return this.tx.paymentStatus === 'paid';
  }

  /** Troca tipo e/ou direção. Só valida quando algo muda: um tipo que ficou inativo não trava a edição do resto. */
  changeKind(type: TxType, movement: MovementType | undefined) {
    if (!movement) throw new BusinessRuleViolation('Tipo de movimentação inválido');
    const same = type === this.tx.type && movement.id === this.tx.movementTypeId;
    if (!same) {
      if (!movement.active)
        throw new BusinessRuleViolation('Este tipo está inativo. Escolha outro tipo de movimentação.');
      if (!acceptsDirection(movement, type)) {
        throw new BusinessRuleViolation(
          'Este tipo não aceita essa direção (entrada/saída). Troque o tipo ou a direção.',
        );
      }
    }
    this.tx.type = type;
    this.tx.movementTypeId = movement.id;
  }

  changeAmount(amount: number) {
    this.tx.amount = Money.of(amount).toNumber();
  }

  /**
   * Muda a situação e/ou a data de pagamento. Ao virar pago, avisa (TransactionPaid) — se for parcela de acordo,
   * quem cuida do acordo dá a parcela por quitada. Toda mudança de pagamento também é avisada.
   */
  changePayment(
    movement: MovementType,
    status: Transaction['paymentStatus'],
    paidAt: string | null | undefined,
    userId: string,
    today = todayISO(),
  ) {
    const wasPaid = this.isPaid;
    stampPaidAt(this.tx, movement.name, status, paidAt, today);
    if (!wasPaid && this.isPaid) {
      this.events.push(
        transactionPaid({
          transactionId: this.tx.id,
          method: this.tx.method,
          paidAt: this.tx.paidAt ?? this.tx.date,
          userId,
          arrears:
            this.tx.arrearsId && this.tx.arrearsYearMonth
              ? { planId: this.tx.arrearsId, yearMonth: this.tx.arrearsYearMonth, source: 'separate' }
              : undefined,
        }),
      );
    }
    const changed: TransactionPaymentChanged = { type: 'TransactionPaymentChanged', transaction: this.tx, userId };
    this.events.push(changed);
  }

  /** `null` desvincula; `undefined` mantém. */
  assign(field: 'memberId' | 'memberAccountId' | 'projectId', value: string | null | undefined) {
    if (value === null) delete this.tx[field];
    else if (value) this.tx[field] = value;
  }

  touch(userId: string) {
    Object.assign(this.tx, updatedAudit(userId));
  }

  pullEvents(): DomainEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}
