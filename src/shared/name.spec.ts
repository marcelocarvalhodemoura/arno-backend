import { titleCaseName } from './name';

describe('titleCaseName', () => {
  it('normalizes all-caps Portuguese names', () => {
    expect(titleCaseName('ALANA DA SILVA RAMOS')).toBe('Alana da Silva Ramos');
    expect(titleCaseName('ANDRÉS MIGUEL DE FIGUEIREDO MAGNUS')).toBe('Andrés Miguel de Figueiredo Magnus');
    expect(titleCaseName('ANA CLARA DOS CASAES CABRAL')).toBe('Ana Clara dos Casaes Cabral');
  });

  it('keeps already-normalized names stable', () => {
    expect(titleCaseName('Aleksander Jean Furlin')).toBe('Aleksander Jean Furlin');
    expect(titleCaseName('Cristina da Silva Pereira')).toBe('Cristina da Silva Pereira');
  });

  it('trims and collapses spaces', () => {
    expect(titleCaseName('  maria   de  SOUZA  ')).toBe('Maria de Souza');
  });

  it('capitalizes hyphenated parts', () => {
    expect(titleCaseName('MARIA-CLARA DE OLIVEIRA')).toBe('Maria-Clara de Oliveira');
  });

  it('capitalizes particle when it is the first word', () => {
    expect(titleCaseName('DA SILVA')).toBe('Da Silva');
  });
});
