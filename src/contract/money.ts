import { ContractViolation } from './errors';

/**
 * Valor em reais guardado em centavos inteiros: somar, subtrair e dividir nunca deixa sobra de ponto flutuante.
 * `Money.of(x).toNumber()` arredonda igual a `roundMoney(x)`.
 */
export class Money {
  private constructor(readonly cents: number) {}

  static of(reais: number): Money {
    if (!Number.isFinite(reais)) throw new ContractViolation('Valor inválido');
    return new Money(Math.round(reais * 100));
  }

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) throw new ContractViolation('Centavos precisam ser inteiros');
    return new Money(cents);
  }

  static zero(): Money {
    return new Money(0);
  }

  static sum(values: Iterable<Money | number>): Money {
    let cents = 0;
    for (const value of values) cents += (value instanceof Money ? value : Money.of(value)).cents;
    return new Money(cents);
  }

  plus(other: Money | number): Money {
    return new Money(this.cents + Money.from(other).cents);
  }

  minus(other: Money | number): Money {
    return new Money(this.cents - Money.from(other).cents);
  }

  times(factor: number): Money {
    return new Money(Math.round(this.cents * factor));
  }

  equals(other: Money | number): boolean {
    return this.cents === Money.from(other).cents;
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  isPositive(): boolean {
    return this.cents > 0;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  /** Divide em `parts` sem perder centavo: os primeiros recebem a sobra (100 / 3 → 33,34 + 33,33 + 33,33). */
  allocate(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts < 1) throw new ContractViolation('Informe ao menos uma parte');
    const base = Math.trunc(this.cents / parts);
    const remainder = this.cents - base * parts;
    const step = Math.sign(remainder);
    return Array.from({ length: parts }, (_, index) => new Money(base + (index < Math.abs(remainder) ? step : 0)));
  }

  toNumber(): number {
    return this.cents / 100;
  }

  /** R$ 1.234,56 */
  format(): string {
    return this.toNumber().toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  toJSON(): number {
    return this.toNumber();
  }

  private static from(value: Money | number): Money {
    return value instanceof Money ? value : Money.of(value);
  }
}
