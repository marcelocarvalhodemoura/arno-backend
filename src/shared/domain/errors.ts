/**
 * Erros de regra de negócio. O `AllExceptionsFilter` responde `{ error: message }` com o `status` de cada um,
 * então os services não precisam de try/catch só para traduzir erro em HTTP.
 * Falhas de infraestrutura (S3, Sicredi, leitura de PDF) continuam como `Error` e são tratadas onde acontecem.
 */
export abstract class DomainError extends Error {
  abstract readonly status: 400 | 404 | 409;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A operação fere uma regra do domínio (direção do tipo, mês fechado, valor do rateio...). */
export class BusinessRuleViolation extends DomainError {
  readonly status = 400;
}

/** O registro pedido não existe. */
export class NotFound extends DomainError {
  readonly status = 404;
}

/** Já existe um registro com a mesma identidade de negócio (nome do tipo, nome da taxa...). */
export class Conflict extends DomainError {
  readonly status = 409;
}
