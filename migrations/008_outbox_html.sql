ALTER TABLE message_outbox
  ADD COLUMN IF NOT EXISTS html_body TEXT;
