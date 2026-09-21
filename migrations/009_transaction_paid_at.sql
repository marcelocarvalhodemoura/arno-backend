ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS paid_at DATE;

UPDATE transactions AS tx
SET paid_at = tx.date
FROM movement_types AS mt
WHERE tx.movement_type_id = mt.id
  AND tx.payment_status = 'paid'
  AND tx.paid_at IS NULL
  AND lower(mt.name) NOT LIKE '%mensalidade%';
