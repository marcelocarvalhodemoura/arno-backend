-- CreateTable
CREATE TABLE "member_status_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "member_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_id" UUID,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "member_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_status_history_member_id_at_idx" ON "member_status_history"("member_id", "at");
