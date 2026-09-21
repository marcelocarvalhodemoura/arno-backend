ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS member_guardian_id UUID REFERENCES member_guardians (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_member_guardian ON transactions (member_guardian_id);
