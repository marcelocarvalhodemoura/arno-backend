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
import { configuredNotifyChannels, notifyTransaction, summarizeDeliveries } from '../notifications/notify';
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
    try {
      return memberProfile(await loadDb(), memberId);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Associado não encontrado', HttpStatus.NOT_FOUND);
    }
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
    try {
      return await mutate((db) => confirmReconciliation(db, parsed.data.creditId, parsed.data.pendingId, userId));
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Não foi possível conciliar', HttpStatus.BAD_REQUEST);
    }
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
    try {
      return listOpenMensalidades(await loadDb(), memberId);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Associado não encontrado', HttpStatus.NOT_FOUND);
    }
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
    try {
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

      const channels = configuredNotifyChannels();
      const notified: Transaction[] = [];
      let notifySummary = {
        queued: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        note: undefined as string | undefined,
      };

      for (const item of settled.items) {
        if (!item.shouldNotify || !item.tx.memberId) {
          notified.push(item.tx);
          continue;
        }
        if (!channels.length) {
          notifySummary.skipped += 1;
          notifySummary.total += 1;
          notifySummary.note = 'Configure MAIL_HOST (ou MAIL_MOCK=1) para enviar o recibo';
          notified.push(item.tx);
          continue;
        }
        const db = await loadDb();
        const notify = summarizeDeliveries(await notifyTransaction(db, item.tx, 'receipt', channels, userId));
        notifySummary.queued += notify.queued;
        notifySummary.sent += notify.sent;
        notifySummary.failed += notify.failed;
        notifySummary.skipped += notify.skipped;
        notifySummary.total += notify.total;
        notified.push({ ...item.tx });
      }

      const amount = roundMoneySum(settled.items.map((item) => item.tx.amount));
      if (ids.length === 1) {
        return {
          ...notified[0],
          notify: notifySummary.total || notifySummary.note ? notifySummary : undefined,
        };
      }
      return {
        settled: notified.length,
        amount,
        items: notified,
        notify: notifySummary.total || notifySummary.note ? notifySummary : undefined,
      };
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err) throw err;
      fail(err instanceof Error ? err.message : 'Não foi possível registrar o pagamento', HttpStatus.BAD_REQUEST);
    }
  }

  async allocatePreview(body: unknown) {
    const parsed = allocatePreviewBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe o associado, pontual/atraso e ao menos dois meses (AAAA-MM)', HttpStatus.BAD_REQUEST);
    }
    try {
      return previewAllocateMensalidades(await loadDb(), parsed.data);
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err) throw err;
      fail(err instanceof Error ? err.message : 'Não foi possível calcular o rateio', HttpStatus.BAD_REQUEST);
    }
  }

  async allocate(body: unknown, userId: string) {
    const parsed = allocateBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe o lançamento, o associado, pontual/atraso e ao menos dois meses (AAAA-MM)', HttpStatus.BAD_REQUEST);
    }
    try {
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

      let notifySummary = {
        queued: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        note: undefined as string | undefined,
      };
      if (allocated.shouldNotify) {
        const channels = configuredNotifyChannels();
        if (!channels.length) {
          notifySummary.note = 'Configure MAIL_HOST (ou MAIL_MOCK=1) para enviar o recibo';
        } else {
          const db = await loadDb();
          for (const tx of allocated.items) {
            if (!tx.memberId) continue;
            const notify = summarizeDeliveries(await notifyTransaction(db, tx, 'receipt', channels, userId));
            notifySummary.queued += notify.queued;
            notifySummary.sent += notify.sent;
            notifySummary.failed += notify.failed;
            notifySummary.skipped += notify.skipped;
            notifySummary.total += notify.total;
          }
        }
      }

      return {
        settled: allocated.items.length,
        amount: allocated.amount,
        items: allocated.items,
        notify: notifySummary.total || notifySummary.note ? notifySummary : undefined,
      };
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err) throw err;
      fail(err instanceof Error ? err.message : 'Não foi possível ratear as mensalidades', HttpStatus.BAD_REQUEST);
    }
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
      if (isMensalidadeYearGenerated(db, parsed.data.year)) syncMensalidades(db, parsed.data.year, userId);
      return buildMensalidadeReport(db, parsed.data.year);
    });
    const db = await loadDb();
    const txIds = collectMensalidadeNotifyIds(report, parsed.data);
    return notifyMensalidadeTransactions(db, txIds, parsed.data.kind, channels, userId);
  }
}
