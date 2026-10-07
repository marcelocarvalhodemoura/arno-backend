-- Público do tipo de movimentação: internal (associados), external (comunidade) ou general (não se aplica).
ALTER TABLE "movement_types" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'general';
