import { pool } from '../shared/db';
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
  await pool.query(
    `INSERT INTO message_outbox (
       id, kind, channel, status, member_id, transaction_id, to_address, subject, body, html_body, error, sent_at, created_by, next_attempt_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
    [
      rowId,
      row.kind,
      row.channel,
      row.status,
      row.memberId ?? null,
      row.transactionId ?? null,
      row.to,
      row.subject,
      row.body,
      row.html ?? null,
      row.error ?? null,
      row.status === 'sent' ? new Date().toISOString() : null,
      row.userId,
    ],
  );
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
  const result = await pool.query(
    `SELECT id, kind, channel, status, to_address, subject, error, created_at, sent_at
     FROM message_outbox
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as NotifyKind,
    channel: row.channel as NotifyChannel,
    status: row.status as NotifyDelivery['status'],
    to: String(row.to_address ?? ''),
    subject: String(row.subject ?? ''),
    error: row.error ? String(row.error) : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    sentAt: row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at ? String(row.sent_at) : undefined,
  }));
}

export function summarizeDeliveries(items: NotifyDelivery[]) {
  const sent = items.filter((item) => item.status === 'sent').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const skipped = items.filter((item) => item.status === 'skipped').length;
  const queued = items.filter((item) => item.status === 'queued' || item.status === 'sending').length;
  return { queued, sent, failed, skipped, total: items.length };
}
