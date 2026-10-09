/** Valor que fere uma regra do contrato (valor inválido, competência fora do formato). No backend, responde 400. */
export class ContractViolation extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ContractViolation';
  }
}
