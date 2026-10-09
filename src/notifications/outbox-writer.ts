import { prisma } from '../shared/db';
import { id } from '../shared/id';
import { kickOutbox } from './outbox';
import type { NotifyChannel, NotifyDelivery, NotifyKind } from './types';

export type OutboxRow = {
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
};

/** Onde as mensagens ficam enfileiradas até o worker enviar. */
export interface OutboxWriter {
  record(row: OutboxRow): Promise<string>;
  /** Acorda o worker para enviar o que está na fila. */
  kick(): void;
}

export async function recordOutbox(row: OutboxRow) {
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

export const prismaOutboxWriter: OutboxWriter = {
  record: recordOutbox,
  kick: kickOutbox,
};
