-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "import_source" TEXT;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_source_check" CHECK (
  "import_source" IS NULL OR "import_source" IN ('csv', 'pdf', 'sicredi')
);
