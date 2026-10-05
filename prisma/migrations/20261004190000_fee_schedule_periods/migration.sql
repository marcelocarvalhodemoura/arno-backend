-- Composição da mensalidade por período de vigência (tela "Composição da mensalidade").
-- Vazia = o sistema usa a tabela padrão do código e grava na primeira alteração do financeiro.
CREATE TABLE "fee_schedule_periods" (
    "id" UUID NOT NULL,
    "start_month" TEXT NOT NULL,
    "end_month" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "regular" JSONB NOT NULL,
    "pioneer" JSONB NOT NULL,
    "family_non_member" JSONB,
    "family_member" JSONB,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,
    CONSTRAINT "fee_schedule_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fee_schedule_periods_start_month_key" ON "fee_schedule_periods"("start_month");
