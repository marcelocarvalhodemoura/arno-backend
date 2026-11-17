-- Permutas: serviço prestado ao grupo que abate mensalidades; a sobra vira doação. Aprovação da diretoria.
CREATE TABLE "barters" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "member_id" UUID,
    "donor_name" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "service_date" DATE NOT NULL,
    "expense_type_id" UUID NOT NULL,
    "donation_type_id" UUID NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision_note" TEXT NOT NULL DEFAULT '',
    "covered_amount" DECIMAL(12,2),
    "donation_amount" DECIMAL(12,2),
    "settled_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expense_transaction_id" UUID,
    "donation_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,

    CONSTRAINT "barters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "barters_status_idx" ON "barters"("status");
CREATE INDEX "barters_member_id_idx" ON "barters"("member_id");

-- Meio "barter" (permuta) nos lançamentos do caixa. O extrato do banco (bank_movements) nunca tem permuta.
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_method_check";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_method_check" CHECK (method IN ('pix', 'cash', 'transfer', 'card', 'other', 'barter'));
