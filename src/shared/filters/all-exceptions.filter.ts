import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../domain/errors';
import { ContractViolation } from '../../contract/errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { error: body } : body);
      return;
    }
    if (exception instanceof DomainError || exception instanceof ContractViolation) {
      response.status(exception.status).json({ error: exception.message });
      return;
    }
    console.error(exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Erro interno' });
  }
}
