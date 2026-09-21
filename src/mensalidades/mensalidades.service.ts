import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { buildMensalidadeReport, syncMensalidades } from './mensalidades';
import { collectMensalidadeNotifyIds, notifyMensalidadeTransactions } from './notify';
import { fail } from '../shared/http/api';
import { configuredNotifyChannels } from '../notifications/notify';
import { loadDb, mutate } from '../shared/persistence/finance-store';

const notifyBody = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12).optional(),
  kind: z.enum(['charge', 'receipt']),
  memberIds: z.array(z.string()).optional(),
  transactionIds: z.array(z.string()).optional(),
  channels: z
    .array(z.enum(['email', 'whatsapp']))
    .min(1)
    .optional(),
});

@Injectable()
export class MensalidadesService {
  async report(yearQuery: string | undefined, userId: string) {
    const year = Number(yearQuery ?? new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      fail('Informe um ano válido', HttpStatus.BAD_REQUEST);
    }
    return mutate((db) => {
      syncMensalidades(db, year, userId);
      return buildMensalidadeReport(db, year);
    });
  }

  async notify(body: unknown, userId: string) {
    const parsed = notifyBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe o ano, o tipo (cobrança ou comprovante) e os destinatários', HttpStatus.BAD_REQUEST);
    }
    const channels = parsed.data.channels?.length ? parsed.data.channels : configuredNotifyChannels();
    if (!channels.length) {
      fail('Configure e-mail (MAIL_HOST) ou WhatsApp para disparar mensagens', HttpStatus.BAD_REQUEST);
    }
    const report = await mutate((db) => {
      syncMensalidades(db, parsed.data.year, userId);
      return buildMensalidadeReport(db, parsed.data.year);
    });
    const db = await loadDb();
    const txIds = collectMensalidadeNotifyIds(report, parsed.data);
    return notifyMensalidadeTransactions(db, txIds, parsed.data.kind, channels, userId);
  }
}
