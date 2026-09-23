-- AlterTable
ALTER TABLE "members" ADD COLUMN "chief_child" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "member_siblings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "member_id" UUID NOT NULL,
    "sibling_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "member_siblings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_siblings_member_id_sibling_id_key" ON "member_siblings"("member_id", "sibling_id");

-- CreateIndex
CREATE INDEX "member_siblings_sibling_id_idx" ON "member_siblings"("sibling_id");

-- AddForeignKey
ALTER TABLE "member_siblings" ADD CONSTRAINT "member_siblings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_siblings" ADD CONSTRAINT "member_siblings_sibling_id_fkey" FOREIGN KEY ("sibling_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
