import { Competencia } from './competencia';

describe('Competencia', () => {
  it('valida AAAA-MM', () => {
    expect(Competencia.isValid('2026-03')).toBe(true);
    expect(Competencia.isValid('2026-13')).toBe(false);
    expect(Competencia.isValid('2026-3')).toBe(false);
    expect(() => Competencia.parse('2026-00')).toThrow('Competência inválida (use AAAA-MM)');
  });

  it('avança e volta virando o ano', () => {
    expect(Competencia.parse('2026-12').next().toString()).toBe('2027-01');
    expect(Competencia.parse('2026-01').previous().toString()).toBe('2025-12');
    expect(Competencia.parse('2026-11').plusMonths(14).toString()).toBe('2028-01');
  });

  it('compara e reconhece datas do mês', () => {
    const march = Competencia.of(2026, 3);
    expect(march.isBefore(Competencia.parse('2026-04'))).toBe(true);
    expect(march.equals(Competencia.ofDate('2026-03-31'))).toBe(true);
    expect(march.contains('2026-03-10')).toBe(true);
    expect(march.contains('2026-04-01')).toBe(false);
    expect(JSON.stringify({ competence: march })).toBe('{"competence":"2026-03"}');
  });
});
