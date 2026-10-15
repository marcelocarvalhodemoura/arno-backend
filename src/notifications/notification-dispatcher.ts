import type { DatabaseShape, Transaction } from '../shared/types';
import { EmailChannel } from './channels/email.channel';
import type { NotificationChannel } from './channels/notification-channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { prismaOutboxWriter, type OutboxWriter } from './outbox-writer';
import { composeNotifyMessage } from './templates';
import {
  summarizeDeliveries,
  type NotifyChannel,
  type NotifyDelivery,
  type NotifyKind,
  type NotifySummary,
} from './types';

export type ReceiptSummary = NotifySummary & { note?: string };

const NO_CHANNEL_NOTE = 'Configure MAIL_HOST (ou MAIL_MOCK=1) para enviar o recibo';

/** Enfileira cobranças e recibos nos canais pedidos, sem conhecer nenhum canal em particular. */
export class NotificationDispatcher {
  private readonly byName: Map<NotifyChannel, NotificationChannel>;

  constructor(
    channels: NotificationChannel[],
    private readonly outbox: OutboxWriter,
  ) {
    this.byName = new Map(channels.map((channel) => [channel.name, channel]));
  }

  status(): Record<NotifyChannel, boolean> {
    return {
      email: Boolean(this.byName.get('email')?.isConfigured()),
      whatsapp: Boolean(this.byName.get('whatsapp')?.isConfigured()),
    };
  }

  configuredChannels(): NotifyChannel[] {
    return [...this.byName.values()].filter((channel) => channel.isConfigured()).map((channel) => channel.name);
  }

  async notifyTransaction(
    db: DatabaseShape,
    tx: Transaction,
    kind: NotifyKind,
    channels: NotifyChannel[],
    userId: string,
  ): Promise<NotifyDelivery[]> {
    const deliveries: NotifyDelivery[] = [];
    const requested = [...new Set(channels)];
    const base = { kind, memberId: tx.memberId, transactionId: tx.id, userId };

    const deliver = async (channel: NotificationChannel) => {
      let fallbackToEmail = false;
      for (const target of await channel.resolveTargets(db, tx.memberId)) {
        if (target.kind === 'skip') {
          const rowId = await this.outbox.record({
            ...base,
            channel: channel.name,
            status: 'skipped',
            to: target.to,
            subject: '',
            body: '',
            error: target.reason,
          });
          deliveries.push({
            id: rowId,
            kind,
            channel: channel.name,
            status: 'skipped',
            to: target.to,
            error: target.reason,
          });
          fallbackToEmail ||= Boolean(target.fallbackToEmail);
          continue;
        }
        const message = composeNotifyMessage(db, tx, kind, target.who);
        const rowId = await this.outbox.record({
          ...base,
          channel: channel.name,
          status: 'queued',
          to: target.to,
          subject: message.subject,
          body: message.text,
          html: channel.name === 'email' ? message.html : undefined,
        });
        deliveries.push({ id: rowId, kind, channel: channel.name, status: 'queued', to: target.to });
      }
      return fallbackToEmail;
    };

    let emailFallback = false;
    for (const name of requested) {
      const channel = this.byName.get(name);
      if (channel) emailFallback = (await deliver(channel)) || emailFallback;
    }
    // Custo zero: quem não escreveu nas últimas 24 h recebe por e-mail.
    const email = this.byName.get('email');
    if (emailFallback && !requested.includes('email') && email?.isConfigured()) await deliver(email);
    if (deliveries.some((item) => item.status === 'queued')) this.outbox.kick();
    return deliveries;
  }

  /** Recibo de cada lançamento pago nos canais configurados, somando o resultado. */
  async notifyReceipts(db: DatabaseShape, txs: Transaction[], userId: string): Promise<ReceiptSummary> {
    const summary: ReceiptSummary = { queued: 0, sent: 0, failed: 0, skipped: 0, total: 0 };
    const targets = txs.filter((tx) => tx.memberId);
    if (!targets.length) return summary;
    const channels = this.configuredChannels();
    if (!channels.length) {
      return { ...summary, skipped: targets.length, total: targets.length, note: NO_CHANNEL_NOTE };
    }
    for (const tx of targets) {
      const result = summarizeDeliveries(await this.notifyTransaction(db, tx, 'receipt', channels, userId));
      summary.queued += result.queued;
      summary.sent += result.sent;
      summary.failed += result.failed;
      summary.skipped += result.skipped;
      summary.total += result.total;
    }
    return summary;
  }
}

/** Instância usada pelo código que ainda não recebe dependências por injeção (webhooks, sincronização do banco). */
export const notificationDispatcher = new NotificationDispatcher(
  [new EmailChannel(), new WhatsAppChannel()],
  prismaOutboxWriter,
);
