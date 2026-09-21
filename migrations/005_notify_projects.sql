ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS movement_type_id UUID REFERENCES movement_types (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS message_outbox (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  kind TEXT NOT NULL CHECK (kind IN ('charge', 'receipt')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  member_id UUID REFERENCES members (id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions (id) ON DELETE SET NULL,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_message_outbox_created ON message_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_outbox_transaction ON message_outbox (transaction_id);
