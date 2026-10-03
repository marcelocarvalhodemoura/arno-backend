-- Auditoria de uso (super admin): telas abertas, ações que gravam e entradas no sistema.
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "method" TEXT,
    "path" TEXT NOT NULL,
    "status" INTEGER,
    "duration_ms" INTEGER,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_events_at_idx" ON "audit_events"("at");
CREATE INDEX "audit_events_user_id_at_idx" ON "audit_events"("user_id", "at");
