import { prisma } from '../shared/db';
import { id } from '../shared/id';
import { mailConfigured } from './mail';
import { kickOutbox } from './outbox';
import { isMensalidadeName } from '../statement/statement';
import type { DatabaseShape, Transaction } from '../shared/types';
import { composeNotifyMessage } from './templates';
import { whatsappStatus } from './whatsapp';

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
    whatsapp: whatsappStatus().configured || process.env.WHATSAPP_MOCK === '1' || process.env.MAIL_MOCK === '1',
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
  if (member?.email) add(member.name, member.email);
  for (const guardian of db.memberGuardians ?? []) {
    if (guardian.memberId === memberId && guardian.email) add(guardian.name, guardian.email);
  }
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
  for (const channel of uniqueChannels) {
    if (channel === 'email') {
      const targets = emailsOf(db, tx.memberId);
      if (!targets.length) {
        const rowId = await recordOutbox({
          kind,
          channel,
          status: 'skipped',
          memberId: tx.memberId,
          transactionId: tx.id,
          to: '(sem e-mail)',
          subject: '',
          body: '',
          error: 'Associado sem e-mail cadastrado',
          userId,
        });
        deliveries.push({
          id: rowId,
          kind,
          channel,
          status: 'skipped',
          to: '(sem e-mail)',
          error: 'Associado sem e-mail cadastrado',
        });
        continue;
      }
      for (const target of targets) {
        const message = composeNotifyMessage(db, tx, kind, target.name);
        const rowId = await recordOutbox({
          kind,
          channel,
          status: 'queued',
          memberId: tx.memberId,
          transactionId: tx.id,
          to: target.email,
          subject: message.subject,
          body: message.text,
          html: message.html,
          userId,
        });
        deliveries.push({
          id: rowId,
          kind,
          channel,
          status: 'queued',
          to: target.email,
        });
      }
    }
    if (channel === 'whatsapp') {
      const targets = phonesOf(db, tx.memberId);
      if (!targets.length) {
        const rowId = await recordOutbox({
          kind,
          channel,
          status: 'skipped',
          memberId: tx.memberId,
          transactionId: tx.id,
          to: '(sem telefone)',
          subject: '',
          body: '',
          error: 'Associado sem telefone cadastrado',
          userId,
        });
        deliveries.push({
          id: rowId,
          kind,
          channel,
          status: 'skipped',
          to: '(sem telefone)',
          error: 'Associado sem telefone cadastrado',
        });
        continue;
      }
      for (const target of targets) {
        const message = composeNotifyMessage(db, tx, kind, target.name);
        const rowId = await recordOutbox({
          kind,
          channel,
          status: 'queued',
          memberId: tx.memberId,
          transactionId: tx.id,
          to: target.phone,
          subject: message.subject,
          body: message.text,
          userId,
        });
        deliveries.push({
          id: rowId,
          kind,
          channel,
          status: 'queued',
          to: target.phone,
        });
      }
    }
  }
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
