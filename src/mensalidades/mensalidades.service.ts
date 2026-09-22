import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  buildMensalidadeReport,
  setMensalidadeClubFee,
  setMensalidadeClubFeeBulk,
  syncMensalidades,
} from './mensalidades';
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

const clubFeeBody = z.object({
  transactionId: z.string().min(1),
  clubFeeIncluded: z.boolean(),
});

const clubFeeBulkBody = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(3).max(12).optional(),
  clubFeeIncluded: z.boolean(),
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

  async setClubFee(body: unknown, userId: string) {
    const parsed = clubFeeBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe a mensalidade e se a taxa do clube entra ou não', HttpStatus.BAD_REQUEST);
    }
    return mutate((db) => {
      try {
        const tx = setMensalidadeClubFee(db, parsed.data.transactionId, parsed.data.clubFeeIncluded, userId);
        if (!tx) fail('Mensalidade não encontrada', HttpStatus.NOT_FOUND);
        return tx;
      } catch (err) {
        if (err && typeof err === 'object' && 'status' in err) throw err;
        fail(err instanceof Error ? err.message : 'Não foi possível alterar a taxa do clube', HttpStatus.BAD_REQUEST);
      }
    });
  }

  async setClubFeeBulk(body: unknown, userId: string) {
    const parsed = clubFeeBulkBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe o ano e se a taxa do clube entra ou não', HttpStatus.BAD_REQUEST);
    }
    return mutate((db) => {
      syncMensalidades(db, parsed.data.year, userId);
      const updated = setMensalidadeClubFeeBulk(db, parsed.data, userId);
      return { updated, report: buildMensalidadeReport(db, parsed.data.year) };
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
