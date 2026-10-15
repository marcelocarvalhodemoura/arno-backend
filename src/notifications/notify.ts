import { prisma } from '../shared/db';
import { id } from '../shared/id';
import { mailConfigured } from './mail';
import { kickOutbox } from './outbox';
import { isMensalidadeName } from '../statement/statement';
import type { DatabaseShape, Transaction } from '../shared/types';
import { composeNotifyMessage } from './templates';
import { whatsappStatus } from './whatsapp';
import { OUTSIDE_WINDOW_ERROR, windowOpen } from './whatsapp-window';
import { appConfig } from '../shared/config';

export type NotifyKind = 'charge' | 'receipt';
export type NotifyChannel = 'email' | 'whatsapp';

export type NotifyDelivery = {
  id: string;
  kind: NotifyKind;
  channel: NotifyChannel;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
  to: string;
  error?: string;
};

export function notifyStatus() {
  return {
    email: mailConfigured(),
    whatsapp: whatsappStatus().configured || appConfig.whatsapp.mock,
  };
}

export function configuredNotifyChannels(): NotifyChannel[] {
  const status = notifyStatus();
  const channels: NotifyChannel[] = [];
  if (status.email) channels.push('email');
  if (status.whatsapp) channels.push('whatsapp');
  return channels;
}

function emailsOf(db: DatabaseShape, memberId?: string) {
  if (!memberId) return [];
  const member = db.members.find((item) => item.id === memberId);
  const list: { name: string; email: string }[] = [];
  const seen = new Set<string>();
  function add(name: string, email: string) {
    const key = email.trim().toLowerCase();
    if (!key || !key.includes('@') || seen.has(key)) return;
    seen.add(key);
    list.push({ name: name.trim() || member?.name || 'Família', email: key });
  }
  for (const guardian of db.memberGuardians ?? []) {
    if (guardian.memberId === memberId && guardian.email) add(guardian.name, guardian.email);
  }
  if (member?.email) add(member.name, member.email);
  return list;
}

function phonesOf(db: DatabaseShape, memberId?: string) {
  if (!memberId) return [];
  const member = db.members.find((item) => item.id === memberId);
  const list: { name: string; phone: string }[] = [];
  const seen = new Set<string>();
  function add(name: string, phone: string) {
    const digits = phone.replace(/\D/g, '');
    if (!digits || seen.has(digits)) return;
    seen.add(digits);
    list.push({ name: name.trim() || member?.name || 'Família', phone });
  }
  if (member?.phone) add(member.name, member.phone);
  for (const guardian of db.memberGuardians ?? []) {
    if (guardian.memberId === memberId && guardian.phone) add(guardian.name, guardian.phone);
  }
  return list;
}

async function recordOutbox(row: {
  kind: NotifyKind;
  channel: NotifyChannel;
  status: NotifyDelivery['status'];
  memberId?: string;
  transactionId?: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  error?: string;
  userId: string;
}) {
  const rowId = id();
  await prisma.messageOutbox.create({
    data: {
      id: rowId,
      kind: row.kind,
      channel: row.channel,
      status: row.status,
      memberId: row.memberId ?? null,
      transactionId: row.transactionId ?? null,
      toAddress: row.to,
      subject: row.subject,
      body: row.body,
      htmlBody: row.html ?? null,
      error: row.error ?? null,
      sentAt: row.status === 'sent' ? new Date() : null,
      createdById: row.userId,
      nextAttemptAt: new Date(),
    },
  });
  return rowId;
}

export async function notifyTransaction(
  db: DatabaseShape,
  tx: Transaction,
  kind: NotifyKind,
  channels: NotifyChannel[],
  userId: string,
): Promise<NotifyDelivery[]> {
  const deliveries: NotifyDelivery[] = [];
  const uniqueChannels = [...new Set(channels)];
  const base = { kind, memberId: tx.memberId, transactionId: tx.id, userId };

  async function skip(channel: NotifyChannel, to: string, error: string) {
    const rowId = await recordOutbox({ ...base, channel, status: 'skipped', to, subject: '', body: '', error });
    deliveries.push({ id: rowId, kind, channel, status: 'skipped', to, error });
  }

  async function queue(channel: NotifyChannel, to: string, who: string) {
    const message = composeNotifyMessage(db, tx, kind, who);
    const rowId = await recordOutbox({
      ...base,
      channel,
      status: 'queued',
      to,
      subject: message.subject,
      body: message.text,
      html: channel === 'email' ? message.html : undefined,
    });
    deliveries.push({ id: rowId, kind, channel, status: 'queued', to });
  }

  async function queueEmails() {
    const targets = emailsOf(db, tx.memberId);
    if (!targets.length) return skip('email', '(sem e-mail)', 'Associado sem e-mail cadastrado');
    for (const target of targets) await queue('email', target.email, target.name);
  }

  let emailFallback = false;
  for (const channel of uniqueChannels) {
    if (channel === 'email') await queueEmails();
    if (channel === 'whatsapp') {
      const targets = phonesOf(db, tx.memberId);
      if (!targets.length) {
        await skip('whatsapp', '(sem telefone)', 'Associado sem telefone cadastrado');
        continue;
      }
      const mock = appConfig.whatsapp.mock;
      for (const target of targets) {
        if (mock || (await windowOpen(target.phone))) {
          await queue('whatsapp', target.phone, target.name);
        } else {
          await skip('whatsapp', target.phone, OUTSIDE_WINDOW_ERROR);
          emailFallback = true;
        }
      }
    }
  }
  // Custo zero: quem não escreveu nas últimas 24 h recebe por e-mail.
  if (emailFallback && !uniqueChannels.includes('email') && mailConfigured()) await queueEmails();
  if (deliveries.some((item) => item.status === 'queued')) kickOutbox();
  return deliveries;
}

export function isMensalidadeTx(db: DatabaseShape, tx: Transaction) {
  if (tx.type !== 'income') return false;
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return Boolean(movement && isMensalidadeName(movement.name));
}

export async function listNotifications(limit = 40) {
  const rows = await prisma.messageOutbox.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      kind: true,
      channel: true,
      status: true,
      toAddress: true,
      subject: true,
      error: true,
      createdAt: true,
      sentAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as NotifyKind,
    channel: row.channel as NotifyChannel,
    status: row.status as NotifyDelivery['status'],
    to: row.toAddress,
    subject: row.subject,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString(),
  }));
}

export function summarizeDeliveries(items: NotifyDelivery[]) {
  const sent = items.filter((item) => item.status === 'sent').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const skipped = items.filter((item) => item.status === 'skipped').length;
  const queued = items.filter((item) => item.status === 'queued' || item.status === 'sending').length;
  return { queued, sent, failed, skipped, total: items.length };
}

export const MANUAL_WHATSAPP_SUBJECT = 'Cobrança enviada pela tesouraria (link wa.me)';

/** Registra no histórico a cobrança que a tesouraria enviou do próprio WhatsApp pelo link wa.me. */
export async function recordManualWhatsApp(input: {
  memberId: string;
  phone: string;
  text: string;
  transactionIds: string[];
  userId: string;
}) {
  return recordOutbox({
    kind: 'charge',
    channel: 'whatsapp',
    status: 'sent',
    memberId: input.memberId,
    transactionId: input.transactionIds[0],
    to: input.phone,
    subject: MANUAL_WHATSAPP_SUBJECT,
    body: input.text,
    userId: input.userId,
  });
}

/** Data da última cobrança por WhatsApp enviada a cada associado. */
export async function lastWhatsAppChargeByMember() {
  const rows = await prisma.messageOutbox.groupBy({
    by: ['memberId'],
    where: { kind: 'charge', channel: 'whatsapp', status: 'sent', memberId: { not: null } },
    _max: { sentAt: true },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.memberId && row._max.sentAt) map.set(row.memberId, row._max.sentAt.toISOString());
  }
  return map;
}
