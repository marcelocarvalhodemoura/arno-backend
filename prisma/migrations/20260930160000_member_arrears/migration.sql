-- Dívidas diluídas (acordos) + vínculo opcional em lançamentos (modo separate).
CREATE TABLE "member_arrears" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "member_id" UUID NOT NULL,
    "original_amount" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "installment_amount" DECIMAL(12,2) NOT NULL,
    "total_count" INTEGER NOT NULL,
    "remaining_count" INTEGER NOT NULL,
    "start_year_month" TEXT NOT NULL,
    "charge_mode" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,

    CONSTRAINT "member_arrears_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "member_arrears_member_id_idx" ON "member_arrears"("member_id");
CREATE INDEX "member_arrears_status_idx" ON "member_arrears"("status");

ALTER TABLE "member_arrears" ADD CONSTRAINT "member_arrears_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_arrears" ADD CONSTRAINT "member_arrears_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "member_arrears" ADD CONSTRAINT "member_arrears_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD COLUMN "arrears_id" UUID;
ALTER TABLE "transactions" ADD COLUMN "arrears_year_month" TEXT;

CREATE INDEX "transactions_arrears_id_idx" ON "transactions"("arrears_id");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_arrears_id_fkey" FOREIGN KEY ("arrears_id") REFERENCES "member_arrears"("id") ON DELETE SET NULL ON UPDATE CASCADE;
