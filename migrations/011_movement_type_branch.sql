ALTER TABLE movement_types
  ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT 'grupo';

ALTER TABLE movement_types
  DROP CONSTRAINT IF EXISTS movement_types_branch_check;

ALTER TABLE movement_types
  ADD CONSTRAINT movement_types_branch_check
  CHECK (
    branch IN ('filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis', 'grupo')
  );
