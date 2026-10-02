import { upperCaseName } from './name';

describe('upperCaseName', () => {
  it('converte para maiúsculas, inclusive acentos', () => {
    expect(upperCaseName('Alana da Silva Ramos')).toBe('ALANA DA SILVA RAMOS');
    expect(upperCaseName('Andrés Miguel de Figueiredo Magnus')).toBe('ANDRÉS MIGUEL DE FIGUEIREDO MAGNUS');
    expect(upperCaseName('joão açaí')).toBe('JOÃO AÇAÍ');
  });

  it('mantém nomes já em maiúsculas', () => {
    expect(upperCaseName('ANA CLARA DOS CASAES CABRAL')).toBe('ANA CLARA DOS CASAES CABRAL');
  });

  it('remove espaços extras', () => {
    expect(upperCaseName('  maria   de  SOUZA  ')).toBe('MARIA DE SOUZA');
  });

  it('preserva hífen', () => {
    expect(upperCaseName('Maria-Clara de Oliveira')).toBe('MARIA-CLARA DE OLIVEIRA');
  });
});
