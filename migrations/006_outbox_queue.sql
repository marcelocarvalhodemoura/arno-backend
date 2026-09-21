ALTER TABLE message_outbox
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

ALTER TABLE message_outbox DROP CONSTRAINT IF EXISTS message_outbox_status_check;
ALTER TABLE message_outbox ADD CONSTRAINT message_outbox_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_message_outbox_queue
  ON message_outbox (next_attempt_at, created_at)
  WHERE status = 'queued';
