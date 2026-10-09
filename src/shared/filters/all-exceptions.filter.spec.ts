import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { BusinessRuleViolation, Conflict, NotFound } from '../domain/errors';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostCapturing() {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  return { host, sent };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it.each([
    [new BusinessRuleViolation('Mês fechado'), 400],
    [new NotFound('Lançamento não encontrado'), 404],
    [new Conflict('Tipo já cadastrado'), 409],
  ])('responde erros de domínio com o status e a mensagem (%s)', (error, status) => {
    const { host, sent } = hostCapturing();
    filter.catch(error, host);
    expect(sent).toEqual({ status, body: { error: error.message } });
  });

  it('mantém o corpo das HttpException', () => {
    const { host, sent } = hostCapturing();
    filter.catch(new HttpException({ error: 'Sem permissão' }, HttpStatus.FORBIDDEN), host);
    expect(sent).toEqual({ status: 403, body: { error: 'Sem permissão' } });
  });

  it('esconde erros inesperados atrás de 500', () => {
    const { host, sent } = hostCapturing();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    filter.catch(new TypeError('x is undefined'), host);
    spy.mockRestore();
    expect(sent).toEqual({ status: 500, body: { error: 'Erro interno' } });
  });
});
