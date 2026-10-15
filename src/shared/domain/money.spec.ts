import { roundMoney } from '../types';
import { Money } from './money';

describe('Money', () => {
  it('arredonda igual ao roundMoney', () => {
    for (const value of [0, 0.1, 10.005, 33.333, 89.5, 1234.5678, -12.345]) {
      expect(Money.of(value).toNumber()).toBe(roundMoney(value));
    }
  });

  it('soma sem erro de ponto flutuante', () => {
    expect(Money.of(0.1).plus(0.2).toNumber()).toBe(0.3);
    expect(Money.sum([0.1, 0.2, Money.of(0.3)]).toNumber()).toBe(0.6);
    expect(Money.of(100).minus(33.33).toNumber()).toBe(66.67);
  });

  it('divide sem perder centavos', () => {
    expect(
      Money.of(100)
        .allocate(3)
        .map((part) => part.toNumber()),
    ).toEqual([33.34, 33.33, 33.33]);
    expect(
      Money.of(-100)
        .allocate(3)
        .map((part) => part.toNumber()),
    ).toEqual([-33.34, -33.33, -33.33]);
    expect(Money.sum(Money.of(89.5).allocate(7)).toNumber()).toBe(89.5);
  });

  it('compara e serializa como número', () => {
    expect(Money.of(10).equals(10.001)).toBe(true);
    expect(Money.zero().isZero()).toBe(true);
    expect(JSON.stringify({ amount: Money.of(12.5) })).toBe('{"amount":12.5}');
  });

  it('recusa valores inválidos', () => {
    expect(() => Money.of(Number.NaN)).toThrow('Valor inválido');
    expect(() => Money.of(10).allocate(0)).toThrow();
    expect(() => Money.fromCents(1.5)).toThrow();
  });
});
