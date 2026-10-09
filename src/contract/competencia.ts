import { ContractViolation } from './errors';

const pad2 = (n: number) => String(n).padStart(2, '0');

const PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Mês de referência de uma cobrança (AAAA-MM). */
export class Competencia {
  private constructor(
    readonly year: number,
    readonly month: number,
  ) {}

  static isValid(value: string): boolean {
    return PATTERN.test(value);
  }

  static parse(value: string): Competencia {
    const match = PATTERN.exec(value);
    if (!match) throw new ContractViolation('Competência inválida (use AAAA-MM)');
    return new Competencia(Number(match[1]), Number(match[2]));
  }

  static of(year: number, month: number): Competencia {
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new ContractViolation('Competência inválida (use AAAA-MM)');
    }
    return new Competencia(year, month);
  }

  /** Competência de uma data ISO (AAAA-MM-DD). */
  static ofDate(date: string): Competencia {
    return Competencia.parse(date.slice(0, 7));
  }

  next(): Competencia {
    return this.plusMonths(1);
  }

  previous(): Competencia {
    return this.plusMonths(-1);
  }

  plusMonths(months: number): Competencia {
    const index = this.year * 12 + (this.month - 1) + months;
    return new Competencia(Math.floor(index / 12), (index % 12) + 1);
  }

  compare(other: Competencia): number {
    return this.year * 12 + this.month - (other.year * 12 + other.month);
  }

  isBefore(other: Competencia): boolean {
    return this.compare(other) < 0;
  }

  equals(other: Competencia): boolean {
    return this.compare(other) === 0;
  }

  /** Inclui a data ISO (AAAA-MM-DD)? */
  contains(date: string): boolean {
    return date.slice(0, 7) === this.toString();
  }

  toString(): string {
    return `${this.year}-${pad2(this.month)}`;
  }

  toJSON(): string {
    return this.toString();
  }
}
