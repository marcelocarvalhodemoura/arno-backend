-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "split_group_id" UUID,
ADD COLUMN "split_total" DECIMAL(12, 2),
ADD COLUMN "split_index" INTEGER,
ADD COLUMN "split_count" INTEGER;

-- CreateIndex
CREATE INDEX "transactions_split_group_id_idx" ON "transactions"("split_group_id");
