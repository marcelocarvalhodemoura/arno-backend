import { pool } from '../shared/db';
import { sendMail } from './mail';
import { sendWhatsAppText } from './whatsapp';

type NotifyChannel = 'email' | 'whatsapp';

type OutboxRow = {
  id: string;
  kind: string;
  channel: string;
  status: string;
  to_address: string;
  subject: string;
  body: string;
  html_body: string | null;
  attempts: number;
  error: string | null;
};

let processing: Promise<number> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function queueConcurrency() {
  const value = Number(process.env.MAIL_QUEUE_CONCURRENCY ?? 3);
  return Number.isFinite(value) && value >= 1 ? Math.min(10, Math.floor(value)) : 3;
}

export function queueMaxAttempts() {
  const value = Number(process.env.MAIL_QUEUE_MAX_ATTEMPTS ?? 5);
  return Number.isFinite(value) && value >= 1 ? Math.min(12, Math.floor(value)) : 5;
}

export function queuePollMs() {
  const value = Number(process.env.MAIL_QUEUE_POLL_MS ?? 1500);
  return Number.isFinite(value) && value >= 250 ? Math.min(30_000, Math.floor(value)) : 1500;
}

export function sendGapMs() {
  const value = Number(process.env.MAIL_SEND_GAP_MS ?? 150);
  return Number.isFinite(value) && value >= 0 ? Math.min(5_000, Math.floor(value)) : 150;
}

export function nextAttemptAt(attempts: number, now = Date.now()) {
  const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(now + delayMs);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function countQueued() {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM message_outbox
     WHERE status IN ('queued', 'sending')`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function recoverStuckSending(olderThanSeconds = 120) {
  const result = await pool.query(
    `UPDATE message_outbox
     SET status = 'queued', next_attempt_at = NOW()
     WHERE status = 'sending'
       AND claimed_at IS NOT NULL
       AND claimed_at < NOW() - make_interval(secs => $1)`,
    [olderThanSeconds],
  );
  return result.rowCount ?? 0;
}

export async function claimQueued(limit: number): Promise<OutboxRow[]> {
  const size = Math.max(1, Math.min(50, Math.floor(limit)));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<OutboxRow>(
      `UPDATE message_outbox AS m
       SET status = 'sending',
           claimed_at = NOW(),
           attempts = m.attempts + 1
       WHERE m.id IN (
         SELECT id
         FROM message_outbox
         WHERE status = 'queued'
           AND next_attempt_at <= NOW()
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       RETURNING m.id, m.kind, m.channel, m.status, m.to_address, m.subject, m.body, m.html_body, m.attempts, m.error`,
      [size],
    );
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function finishRow(id: string, status: 'sent' | 'failed' | 'skipped' | 'queued', error?: string, retryAt?: Date) {
  await pool.query(
    `UPDATE message_outbox
     SET status = $2,
         error = $3,
         sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
         next_attempt_at = COALESCE($4, next_attempt_at),
         claimed_at = CASE WHEN $2 = 'queued' THEN NULL ELSE claimed_at END
     WHERE id = $1`,
    [id, status, error ?? null, retryAt ?? null],
  );
}

export async function deliverRow(row: OutboxRow) {
  const channel = row.channel as NotifyChannel;
  const sent =
    channel === 'email'
      ? await sendMail(row.to_address, row.subject, row.body, row.html_body ?? undefined)
      : await sendWhatsAppText(row.to_address, `${row.subject}\n\n${row.body}`);

  if (sent.ok) {
    await finishRow(row.id, 'sent');
    return 'sent' as const;
  }
  if (sent.skipped) {
    await finishRow(row.id, 'skipped', sent.error);
    return 'skipped' as const;
  }
  if (row.attempts >= queueMaxAttempts()) {
    await finishRow(row.id, 'failed', sent.error);
    return 'failed' as const;
  }
  await finishRow(row.id, 'queued', sent.error, nextAttemptAt(row.attempts));
  return 'queued' as const;
}

async function drainOutbox(maxBatches: number) {
  let delivered = 0;
  const concurrency = queueConcurrency();
  const gap = sendGapMs();
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await claimQueued(concurrency);
    if (!rows.length) break;
    const results = await Promise.all(rows.map((row) => deliverRow(row)));
    delivered += results.length;
    if (gap > 0 && rows.length === concurrency) await sleep(gap);
  }
  return delivered;
}

export async function processOutbox(maxBatches = 40) {
  if (processing) return processing;
  processing = drainOutbox(maxBatches).finally(() => {
    processing = null;
  });
  return processing;
}

export function kickOutbox() {
  if (process.env.VITEST) return;
  void processOutbox().catch((error) => {
    console.error('Fila de mensagens:', error);
  });
}

export function startOutboxWorker() {
  if (timer) return;
  void recoverStuckSending().catch((error) => {
    console.error('Recuperação da fila de mensagens:', error);
  });
  timer = setInterval(() => {
    void processOutbox().catch((error) => {
      console.error('Fila de mensagens:', error);
    });
  }, queuePollMs());
  kickOutbox();
}

export function stopOutboxWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
