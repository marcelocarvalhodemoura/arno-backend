ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS mensalidade_due_day INTEGER NOT NULL DEFAULT 10;

ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_mensalidade_due_day_check;

ALTER TABLE settings
  ADD CONSTRAINT settings_mensalidade_due_day_check
  CHECK (mensalidade_due_day BETWEEN 1 AND 31);
