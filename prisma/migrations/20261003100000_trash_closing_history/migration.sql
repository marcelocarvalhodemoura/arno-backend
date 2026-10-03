-- Lixeira, fechamento do mês, histórico de alterações e revisões descartadas.
CREATE TABLE "transaction_trash" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_by" UUID,
    CONSTRAINT "transaction_trash_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transaction_trash_deleted_at_idx" ON "transaction_trash"("deleted_at");

CREATE TABLE "month_closings" (
    "year_month" TEXT NOT NULL,
    "closed_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_by" UUID,
    "income" DECIMAL(12,2) NOT NULL,
    "expense" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "month_closings_pkey" PRIMARY KEY ("year_month")
);

CREATE TABLE "transaction_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "transaction_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_id" UUID,
    "kind" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    CONSTRAINT "transaction_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transaction_history_transaction_id_at_idx" ON "transaction_history"("transaction_id", "at");

CREATE TABLE "review_dismissals" (
    "key" TEXT NOT NULL,
    "dismissed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_id" UUID,
    CONSTRAINT "review_dismissals_pkey" PRIMARY KEY ("key")
);
