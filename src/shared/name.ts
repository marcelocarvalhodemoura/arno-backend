/**
 * Normaliza nomes próprios para MAIÚSCULAS, sem espaços sobrando.
 * Ex.: "  Alana da  Silva Ramos " → "ALANA DA SILVA RAMOS"
 */
export function upperCaseName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
}
