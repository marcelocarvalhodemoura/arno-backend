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

export type NotifySummary = {
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
};

export function summarizeDeliveries(items: NotifyDelivery[]): NotifySummary {
  const sent = items.filter((item) => item.status === 'sent').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const skipped = items.filter((item) => item.status === 'skipped').length;
  const queued = items.filter((item) => item.status === 'queued' || item.status === 'sending').length;
  return { queued, sent, failed, skipped, total: items.length };
}
