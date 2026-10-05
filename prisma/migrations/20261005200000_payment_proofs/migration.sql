-- Comprovantes de pagamento enviados pelos associados no WhatsApp. O extrato continua sendo a
-- fonte do dinheiro; o comprovante só diz de qual associado é cada crédito.
CREATE TABLE "payment_proofs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "phone" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL DEFAULT '',
    "member_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'outro',
    "source" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "date" DATE,
    "e2e" TEXT,
    "bank" TEXT NOT NULL DEFAULT '',
    "payer_name" TEXT NOT NULL DEFAULT '',
    "payer_document" TEXT NOT NULL DEFAULT '',
    "payee_name" TEXT NOT NULL DEFAULT '',
    "payee_document" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "raw_text" TEXT NOT NULL DEFAULT '',
    "file_key" TEXT,
    "file_name" TEXT,
    "content_type" TEXT,
    "credit_id" UUID,
    "message_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_proofs_message_id_key" ON "payment_proofs"("message_id");
CREATE INDEX "payment_proofs_status_idx" ON "payment_proofs"("status");
CREATE INDEX "payment_proofs_e2e_idx" ON "payment_proofs"("e2e");
CREATE INDEX "payment_proofs_phone_idx" ON "payment_proofs"("phone");
