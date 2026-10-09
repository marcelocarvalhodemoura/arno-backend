import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  allocateBankCreditToMensalidades,
  buildMensalidadeReport,
  isMensalidadeYearGenerated,
  listOpenMensalidades,
  previewGenerateMensalidades,
  previewAllocateMensalidades,
  setMensalidadeClubFee,
  setMensalidadeClubFeeBulk,
  settleMensalidade,
  settleMensalidades,
  syncMensalidades,
} from './mensalidades';
import { collectMensalidadeNotifyIds, notifyMensalidadeTransactions } from './notify';
import { fail } from '../shared/http/api';
import { lastWhatsAppChargeByMember, recordManualWhatsApp } from '../notifications/notify';
import { NotificationDispatcher } from '../notifications/notification-dispatcher';
import { buildWhatsAppChargeQueue } from './whatsapp-queue';
import { dismissReview, loadDb, mutate, readDismissals } from '../shared/persistence/finance-store';
import { confirmReconciliation, reconciliationKey, reconciliationSuggestions } from './reconciliation';
import { assemblyReport, delinquencyReport, memberProfile, nextSteps } from './overview';
import { findDuplicateGroups } from '../ledger/duplicates';
import { getBankSyncState } from '../banking/bank-store';
import { sicrediStatus } from '../banking/sicredi';
import { roundMoney, type Transaction } from '../shared/types';

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

const whatsappSentBody = z.object({
  memberId: z.string().min(1),
  phone: z.string().min(8),
  text: z.string().min(1).max(4000),
  transactionIds: z.array(z.string().min(1)).min(1),
});

const clubFeeBody = z.object({
  transactionId: z.string().min(1),
  clubFeeIncluded: z.boolean(),
});

const clubFeeBulkBody = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(3).max(11).optional(),
  clubFeeIncluded: z.boolean(),
});

const settleBody = z
  .object({
    transactionId: z.string().min(1).optional(),
    transactionIds: z.array(z.string().min(1)).min(1).optional(),
    timing: z.enum(['on_time', 'late']),
    paidAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    notifyReceipt: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.transactionId) || Boolean(data.transactionIds?.length), {
    message: 'Informe transactionId ou transactionIds',
  });

const allocateBody = z.object({
  transactionId: z.string().min(1),
  memberId: z.string().min(1),
  timing: z.enum(['on_time', 'late']),
  yearMonths: z.array(z.string().regex(/^\d{4}-\d{2}$/)).min(2),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  notifyReceipt: z.boolean().optional(),
});

const allocatePreviewBody = z.object({
  memberId: z.string().min(1),
  timing: z.enum(['on_time', 'late']),
  yearMonths: z.array(z.string().regex(/^\d{4}-\d{2}$/)).min(2),
});

function roundMoneySum(amounts: number[]) {
  return roundMoney(amounts.reduce((sum, amount) => sum + amount, 0));
}

@Injectable()
export class MensalidadesService {
  constructor(private readonly notifications: NotificationDispatcher) {}

  async report(yearQuery: string | undefined, userId: string) {
    const year = Number(yearQuery ?? new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      fail('Informe um ano válido', HttpStatus.BAD_REQUEST);
    }
    // Só olhar não gera nada: um ano sem cobranças volta vazio, com a contagem do que seria criado.
    const current = await loadDb();
    if (!isMensalidadeYearGenerated(current, year)) {
      return {
        ...buildMensalidadeReport(current, year),
        generated: false,
        toGenerate: previewGenerateMensalidades(current, year),
      };
    }
    return mutate((db) => {
      syncMensalidades(db, year, userId);
      return { ...buildMensalidadeReport(db, year), generated: true, toGenerate: 0 };
    });
  }

  async nextSteps() {
    const db = await loadDb();
    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const [dupDismissed, reconDismissed, sync] = await Promise.all([
      readDismissals('dup:'),
      readDismissals('recon:'),
      getBankSyncState('sicredi'),
    ]);
    return nextSteps(db, {
      duplicates: findDuplicateGroups(db, dupDismissed).length,
      suggestions: reconciliationSuggestions(db, { from: since, to: today }, reconDismissed).filter(
        (item) => item.suggestion,
      ).length,
      lastSyncAt: sync.lastSyncAt,
      sicrediConfigured: sicrediStatus().configured,
    });
  }

  async memberProfile(memberId: string) {
    return memberProfile(await loadDb(), memberId);
  }

  async assembly(from?: string, to?: string) {
    const valid = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
    if (!valid(from) || !valid(to) || from! > to!)
      fail('Informe o período (de e até, AAAA-MM-DD)', HttpStatus.BAD_REQUEST);
    return assemblyReport(await loadDb(), from!, to!);
  }

  async delinquency(from?: string, to?: string) {
    const valid = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
    if (!valid(from) || !valid(to) || from! > to!)
      fail('Informe o período (de e até, AAAA-MM-DD)', HttpStatus.BAD_REQUEST);
    return delinquencyReport(await loadDb(), from!, to!);
  }

  async reconciliation(from?: string, to?: string) {
    const today = new Date().toISOString().slice(0, 10);
    const start =
      from && /^\d{4}-\d{2}-\d{2}$/.test(from)
        ? from
        : new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const end = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today;
    return reconciliationSuggestions(await loadDb(), { from: start, to: end }, await readDismissals('recon:'));
  }

  async confirmReconciliation(body: unknown, userId: string) {
    const parsed = z.object({ creditId: z.string().min(1), pendingId: z.string().min(1) }).safeParse(body);
    if (!parsed.success) fail('Informe o crédito e a mensalidade', HttpStatus.BAD_REQUEST);
    return mutate((db) => confirmReconciliation(db, parsed.data.creditId, parsed.data.pendingId, userId));
  }

  async dismissReconciliation(body: unknown, userId: string) {
    const parsed = z.object({ creditId: z.string().min(1), pendingId: z.string().min(1) }).safeParse(body);
    if (!parsed.success) fail('Informe o crédito e a mensalidade', HttpStatus.BAD_REQUEST);
    await dismissReview(reconciliationKey(parsed.data.creditId, parsed.data.pendingId), userId);
    return { dismissed: true };
  }

  async generate(body: unknown, userId: string) {
    const parsed = z.object({ year: z.number().int().min(2000).max(2100) }).safeParse(body);
    if (!parsed.success) fail('Informe o ano', HttpStatus.BAD_REQUEST);
    const created = await mutate((db) => syncMensalidades(db, parsed.data.year, userId));
    return { year: parsed.data.year, created };
  }

  async open(memberId: string | undefined) {
    if (!memberId) fail('Informe o associado', HttpStatus.BAD_REQUEST);
    return listOpenMensalidades(await loadDb(), memberId);
  }

  async setClubFee(body: unknown, userId: string) {
    const parsed = clubFeeBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe a mensalidade e se a taxa do clube entra ou não', HttpStatus.BAD_REQUEST);
    }
    return mutate((db) => {
      const tx = setMensalidadeClubFee(db, parsed.data.transactionId, parsed.data.clubFeeIncluded, userId);
      if (!tx) fail('Mensalidade não encontrada', HttpStatus.NOT_FOUND);
      return tx;
    });
  }

  async setClubFeeBulk(body: unknown, userId: string) {
    const parsed = clubFeeBulkBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe o ano e se a taxa do clube entra ou não', HttpStatus.BAD_REQUEST);
    }
    return mutate((db) => {
      if (isMensalidadeYearGenerated(db, parsed.data.year)) syncMensalidades(db, parsed.data.year, userId);
      const updated = setMensalidadeClubFeeBulk(db, parsed.data, userId);
      return { updated, report: buildMensalidadeReport(db, parsed.data.year) };
    });
  }

  async settle(body: unknown, userId: string) {
    const parsed = settleBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe a mensalidade e se o pagamento foi pontual ou com atraso', HttpStatus.BAD_REQUEST);
    }
    const ids = parsed.data.transactionIds?.length
      ? parsed.data.transactionIds
      : parsed.data.transactionId
        ? [parsed.data.transactionId]
        : [];
    const settled = await mutate((db) => {
      if (ids.length === 1) {
        const one = settleMensalidade(
          db,
          {
            transactionId: ids[0],
            timing: parsed.data.timing,
            paidAt: parsed.data.paidAt,
            notifyReceipt: parsed.data.notifyReceipt !== false,
          },
          userId,
        );
        return one ? { items: [one] } : null;
      }
      return settleMensalidades(
        db,
        {
          transactionIds: ids,
          timing: parsed.data.timing,
          paidAt: parsed.data.paidAt,
          notifyReceipt: parsed.data.notifyReceipt !== false,
        },
        userId,
      );
    });
    if (!settled?.items.length) fail('Mensalidade não encontrada', HttpStatus.NOT_FOUND);

    const toNotify = settled.items.filter((item) => item.shouldNotify).map((item) => item.tx);
    const receipts = await this.notifications.notifyReceipts(await loadDb(), toNotify, userId);
    const notify = receipts.total || receipts.note ? receipts : undefined;
    const items = settled.items.map((item) => ({ ...item.tx }));

    if (ids.length === 1) return { ...items[0], notify };
    return {
      settled: items.length,
      amount: roundMoneySum(items.map((item) => item.amount)),
      items,
      notify,
    };
  }

  async allocatePreview(body: unknown) {
    const parsed = allocatePreviewBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe o associado, pontual/atraso e ao menos dois meses (AAAA-MM)', HttpStatus.BAD_REQUEST);
    }
    return previewAllocateMensalidades(await loadDb(), parsed.data);
  }

  async allocate(body: unknown, userId: string) {
    const parsed = allocateBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe o lançamento, o associado, pontual/atraso e ao menos dois meses (AAAA-MM)', HttpStatus.BAD_REQUEST);
    }
    const allocated = await mutate((db) =>
      allocateBankCreditToMensalidades(
        db,
        {
          transactionId: parsed.data.transactionId,
          memberId: parsed.data.memberId,
          timing: parsed.data.timing,
          yearMonths: parsed.data.yearMonths,
          paidAt: parsed.data.paidAt,
          notifyReceipt: parsed.data.notifyReceipt !== false,
        },
        userId,
      ),
    );

    const receipts = allocated.shouldNotify
      ? await this.notifications.notifyReceipts(await loadDb(), allocated.items, userId)
      : null;

    return {
      settled: allocated.items.length,
      amount: allocated.amount,
      items: allocated.items,
      notify: receipts && (receipts.total || receipts.note) ? receipts : undefined,
    };
  }

  async notify(body: unknown, userId: string) {
    const parsed = notifyBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe o ano, o tipo (cobrança ou comprovante) e os destinatários', HttpStatus.BAD_REQUEST);
    }
    const channels = parsed.data.channels?.length ? parsed.data.channels : this.notifications.configuredChannels();
    if (!channels.length) {
      fail('Configure e-mail (MAIL_HOST) ou WhatsApp para disparar mensagens', HttpStatus.BAD_REQUEST);
    }
    const report = await mutate((db) => {
      if (isMensalidadeYearGenerated(db, parsed.data.year)) syncMensalidades(db, parsed.data.year, userId);
      return buildMensalidadeReport(db, parsed.data.year);
    });
    const db = await loadDb();
    const txIds = collectMensalidadeNotifyIds(report, parsed.data);
    return notifyMensalidadeTransactions(db, txIds, parsed.data.kind, channels, userId, this.notifications);
  }

  async whatsappQueue(mode?: string) {
    const wanted = mode === 'upcoming' ? 'upcoming' : 'overdue';
    return buildWhatsAppChargeQueue(await loadDb(), wanted, await lastWhatsAppChargeByMember());
  }

  async whatsappSent(body: unknown, userId: string) {
    const parsed = whatsappSentBody.safeParse(body);
    if (!parsed.success) fail('Informe o associado, o telefone, a mensagem e as mensalidades', HttpStatus.BAD_REQUEST);
    const db = await loadDb();
    if (!db.members.some((item) => item.id === parsed.data.memberId)) {
      fail('Associado não encontrado', HttpStatus.NOT_FOUND);
    }
    const id = await recordManualWhatsApp({ ...parsed.data, userId });
    return { id, sentAt: new Date().toISOString() };
  }
}
