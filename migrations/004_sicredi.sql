ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_origin_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_origin_check
  CHECK (origin IN ('manual', 'integration', 'sicredi'));

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external_id
  ON transactions (external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bank_movements (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  provider TEXT NOT NULL DEFAULT 'sicredi',
  external_id TEXT NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL,
  date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  method TEXT NOT NULL DEFAULT 'pix' CHECK (method IN ('pix', 'cash', 'transfer', 'card', 'other')),
  description TEXT NOT NULL,
  payer_name TEXT NOT NULL DEFAULT '',
  payer_document TEXT NOT NULL DEFAULT '',
  txid TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'matched', 'imported')),
  transaction_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bank_movements_date ON bank_movements (date DESC, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_movements_status ON bank_movements (status);
CREATE INDEX IF NOT EXISTS idx_bank_movements_transaction ON bank_movements (transaction_id);

CREATE TABLE IF NOT EXISTS bank_sync_state (
  provider TEXT PRIMARY KEY,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  last_from DATE,
  last_to DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
