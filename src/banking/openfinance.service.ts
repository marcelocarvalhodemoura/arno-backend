import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { currentMonth, pluggyMonth, syncPluggyMonth } from './pluggy-sync';
import { fail } from '../shared/http/api';
import { errorMessage } from '../shared/http/errors';

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const syncBody = z.object({ month: monthSchema.optional() });

@Injectable()
export class OpenFinanceService {
  async movements(month?: string) {
    const parsed = monthSchema.optional().safeParse(month || undefined);
    if (!parsed.success) fail('Informe o mês no formato AAAA-MM', HttpStatus.BAD_REQUEST);
    try {
      return await pluggyMonth(parsed.data ?? currentMonth());
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível ler as movimentações'), HttpStatus.BAD_REQUEST);
    }
  }

  async sync(body: unknown) {
    const parsed = syncBody.safeParse(body ?? {});
    if (!parsed.success) fail('Informe o mês no formato AAAA-MM', HttpStatus.BAD_REQUEST);
    try {
      return await syncPluggyMonth(parsed.data.month ?? currentMonth());
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível sincronizar pelo Pluggy'), HttpStatus.BAD_REQUEST);
    }
  }
}
