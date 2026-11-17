-- Divisão congelada de cada mensalidade paga (grupo, caixinha do ramo, lanche, clube, diluição, atraso, dívida).
-- Sem FK: a tabela é regravada junto com transactions a cada alteração do financeiro.
CREATE TABLE "mensalidade_allocations" (
    "transaction_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "period_start" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "member_branch" TEXT NOT NULL,
    "clube_ltc" BOOLEAN NOT NULL,
    "late" BOOLEAN NOT NULL,
    "club_fee_included" BOOLEAN NOT NULL,
    "group_share" DECIMAL(12,2) NOT NULL,
    "branch_share" DECIMAL(12,2) NOT NULL,
    "snack_share" DECIMAL(12,2) NOT NULL,
    "club_share" DECIMAL(12,2) NOT NULL,
    "dilution" DECIMAL(12,2) NOT NULL,
    "late_fee" DECIMAL(12,2) NOT NULL,
    "arrears" DECIMAL(12,2) NOT NULL,
    "expected" DECIMAL(12,2) NOT NULL,
    "received" DECIMAL(12,2) NOT NULL,
    "difference" DECIMAL(12,2) NOT NULL,
    "pending_split" BOOLEAN NOT NULL,
    "basis" TEXT NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mensalidade_allocations_pkey" PRIMARY KEY ("transaction_id")
);

CREATE INDEX "mensalidade_allocations_member_id_idx" ON "mensalidade_allocations"("member_id");
