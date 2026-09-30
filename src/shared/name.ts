/** Partículas portuguesas que ficam em minúsculas (exceto no início do nome). */
const LOWERCASE_PARTICLES = new Set([
  'a',
  'as',
  'o',
  'os',
  'de',
  'da',
  'das',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'para',
  'por',
]);

/**
 * Normaliza nomes próprios para o padrão "Primeira Maiúscula".
 * Ex.: "ALANA DA SILVA RAMOS" → "Alana da Silva Ramos"
 */
export function titleCaseName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;

  let wordIndex = 0;
  return trimmed
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part || part === ' ' || part === '-' || /^\s+$/.test(part)) return part;

      const lower = part.toLocaleLowerCase('pt-BR');
      const isFirst = wordIndex === 0;
      wordIndex += 1;

      if (!isFirst && LOWERCASE_PARTICLES.has(lower)) return lower;

      return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    })
    .join('');
}
