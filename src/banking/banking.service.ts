import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { registerPixWebhook, sicrediStatus, simulatedPix, webhookTokenOk } from './sicredi';
import { ingestWebhookPix, sicrediOverview, syncSicrediPix } from './sicredi-sync';
import { fail } from '../shared/http/api';
import { errorMessage } from '../shared/http/errors';

const syncBody = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

@Injectable()
export class BankingService {
  period(from?: string, to?: string) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    return {
      from: from && from.length ? from : `${today.slice(0, 8)}01`,
      to: to && to.length ? to : today,
    };
  }

  async ingestWebhook(token: string | undefined, body: unknown) {
    if (!webhookTokenOk(token)) fail('Webhook não autorizado', HttpStatus.UNAUTHORIZED);
    try {
      const result = await ingestWebhookPix(body);
      return { ok: true, fetched: result.fetched, created: result.created, paid: result.paid };
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível registrar o Pix'), HttpStatus.BAD_REQUEST);
    }
  }

  async overview(from?: string, to?: string) {
    const period = this.period(from, to);
    try {
      return await sicrediOverview(period.from, period.to);
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível ler o Sicredi'), HttpStatus.BAD_REQUEST);
    }
  }

  async sync(body: unknown, userId: string) {
    const parsed = syncBody.safeParse(body ?? {});
    if (!parsed.success) fail('Informe um período válido', HttpStatus.BAD_REQUEST);
    try {
      return await syncSicrediPix({
        from: parsed.data.from,
        to: parsed.data.to,
        userId,
      });
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível sincronizar o Sicredi'), HttpStatus.BAD_REQUEST);
    }
  }

  async simulate(userId: string) {
    if (!sicrediStatus().mock) {
      fail('A simulação só funciona com SICREDI_MOCK=1', HttpStatus.BAD_REQUEST);
    }
    try {
      return await syncSicrediPix({
        userId,
        pix: [simulatedPix()],
      });
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível simular o Pix'), HttpStatus.BAD_REQUEST);
    }
  }

  async registerWebhook() {
    try {
      return await registerPixWebhook();
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível registrar o webhook'), HttpStatus.BAD_REQUEST);
    }
  }
}
