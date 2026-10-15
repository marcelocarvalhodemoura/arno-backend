import { prisma } from '../shared/db';
import { isMensalidadeName } from '../statement/statement';
import type { DatabaseShape, Transaction } from '../shared/types';
import { notificationDispatcher } from './notification-dispatcher';
import { recordOutbox } from './outbox-writer';
import type { NotifyChannel, NotifyDelivery, NotifyKind } from './types';

export type { NotifyChannel, NotifyDelivery, NotifyKind } from './types';
export { summarizeDeliveries } from './types';

export function notifyStatus() {
  return notificationDispatcher.status();
}

export function configuredNotifyChannels(): NotifyChannel[] {
  return notificationDispatcher.configuredChannels();
}

export function notifyTransaction(
  db: DatabaseShape,
  tx: Transaction,
  kind: NotifyKind,
  channels: NotifyChannel[],
  userId: string,
): Promise<NotifyDelivery[]> {
  return notificationDispatcher.notifyTransaction(db, tx, kind, channels, userId);
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
