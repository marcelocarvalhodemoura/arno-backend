CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movement_types" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "pix_key" TEXT NOT NULL DEFAULT '',
    "branch" TEXT NOT NULL DEFAULT 'grupo',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,

    CONSTRAINT "movement_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "monthly_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joined_at" DATE NOT NULL,
    "clube_ltc" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_guardians" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "member_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,

    CONSTRAINT "member_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "member_id" UUID NOT NULL,
    "holder_name" TEXT NOT NULL,
    "holder_kind" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT '',
    "pix_key" TEXT NOT NULL DEFAULT '',
    "bank" TEXT NOT NULL DEFAULT '',
    "agency" TEXT NOT NULL DEFAULT '',
    "account_number" TEXT NOT NULL DEFAULT '',
    "document" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,

    CONSTRAINT "member_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "branch" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "project_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "planned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "movement_type_id" UUID,

    CONSTRAINT "project_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fees" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,

    CONSTRAINT "fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "nature" TEXT NOT NULL,
    "movement_type_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "branch" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "payment_status" TEXT NOT NULL DEFAULT 'paid',
    "paid_at" DATE,
    "member_id" UUID,
    "member_account_id" UUID,
    "member_guardian_id" UUID,
    "project_id" UUID,
    "notes" TEXT,
    "external_id" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" UUID,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "group_name" TEXT NOT NULL,
    "mensalidade_due_day" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_movements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider" TEXT NOT NULL DEFAULT 'sicredi',
    "external_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'pix',
    "description" TEXT NOT NULL,
    "payer_name" TEXT NOT NULL DEFAULT '',
    "payer_document" TEXT NOT NULL DEFAULT '',
    "txid" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "bank_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_sync_state" (
    "provider" TEXT NOT NULL,
    "last_sync_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "last_from" DATE,
    "last_to" DATE,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_sync_state_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "message_outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "member_id" UUID,
    "transaction_id" UUID,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "html_body" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "created_by" UUID,

    CONSTRAINT "message_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "movement_types_name_key" ON "movement_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "members_email_key" ON "members"("email");

-- CreateIndex
CREATE INDEX "members_joined_at_idx" ON "members"("joined_at");

-- CreateIndex
CREATE INDEX "member_guardians_member_id_idx" ON "member_guardians"("member_id");

-- CreateIndex
CREATE INDEX "member_accounts_member_id_idx" ON "member_accounts"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "fees_name_key" ON "fees"("name");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_external_id_key" ON "transactions"("external_id");

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE INDEX "transactions_branch_idx" ON "transactions"("branch");

-- CreateIndex
CREATE INDEX "transactions_movement_type_id_idx" ON "transactions"("movement_type_id");

-- CreateIndex
CREATE INDEX "transactions_payment_status_idx" ON "transactions"("payment_status");

-- CreateIndex
CREATE INDEX "transactions_member_guardian_id_idx" ON "transactions"("member_guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_movements_external_id_key" ON "bank_movements"("external_id");

-- CreateIndex
CREATE INDEX "bank_movements_date_occurred_at_idx" ON "bank_movements"("date", "occurred_at");

-- CreateIndex
CREATE INDEX "bank_movements_status_idx" ON "bank_movements"("status");

-- CreateIndex
CREATE INDEX "bank_movements_transaction_id_idx" ON "bank_movements"("transaction_id");

-- CreateIndex
CREATE INDEX "message_outbox_created_at_idx" ON "message_outbox"("created_at");

-- CreateIndex
CREATE INDEX "message_outbox_transaction_id_idx" ON "message_outbox"("transaction_id");

-- CreateIndex
CREATE INDEX "message_outbox_next_attempt_at_created_at_idx" ON "message_outbox"("next_attempt_at", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_types" ADD CONSTRAINT "movement_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_types" ADD CONSTRAINT "movement_types_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_guardians" ADD CONSTRAINT "member_guardians_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_guardians" ADD CONSTRAINT "member_guardians_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_guardians" ADD CONSTRAINT "member_guardians_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_accounts" ADD CONSTRAINT "member_accounts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_accounts" ADD CONSTRAINT "member_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_accounts" ADD CONSTRAINT "member_accounts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_items" ADD CONSTRAINT "project_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_items" ADD CONSTRAINT "project_items_movement_type_id_fkey" FOREIGN KEY ("movement_type_id") REFERENCES "movement_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_movement_type_id_fkey" FOREIGN KEY ("movement_type_id") REFERENCES "movement_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_member_account_id_fkey" FOREIGN KEY ("member_account_id") REFERENCES "member_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_member_guardian_id_fkey" FOREIGN KEY ("member_guardian_id") REFERENCES "member_guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK (role IN ('admin', 'tesoureiro'));
ALTER TABLE "users" ADD CONSTRAINT "users_origin_check" CHECK (origin IN ('manual', 'integration'));
ALTER TABLE "movement_types" ADD CONSTRAINT "movement_types_direction_check" CHECK (direction IN ('income', 'expense', 'both'));
ALTER TABLE "movement_types" ADD CONSTRAINT "movement_types_origin_check" CHECK (origin IN ('manual', 'integration'));
ALTER TABLE "movement_types" ADD CONSTRAINT "movement_types_branch_check" CHECK (branch IN ('filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis', 'grupo'));
ALTER TABLE "members" ADD CONSTRAINT "members_branch_check" CHECK (branch IN ('filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis'));
ALTER TABLE "members" ADD CONSTRAINT "members_role_check" CHECK (role IN ('jovem', 'escotista', 'dirigente', 'clube'));
ALTER TABLE "members" ADD CONSTRAINT "members_status_check" CHECK (status IN ('active', 'inactive'));
ALTER TABLE "members" ADD CONSTRAINT "members_origin_check" CHECK (origin IN ('manual', 'integration'));
ALTER TABLE "member_guardians" ADD CONSTRAINT "member_guardians_origin_check" CHECK (origin IN ('manual', 'integration'));
ALTER TABLE "member_accounts" ADD CONSTRAINT "member_accounts_holder_kind_check" CHECK (holder_kind IN ('parent', 'youth', 'other'));
ALTER TABLE "member_accounts" ADD CONSTRAINT "member_accounts_origin_check" CHECK (origin IN ('manual', 'integration'));
ALTER TABLE "projects" ADD CONSTRAINT "projects_branch_check" CHECK (branch IN ('filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis', 'grupo'));
ALTER TABLE "projects" ADD CONSTRAINT "projects_origin_check" CHECK (origin IN ('manual', 'integration'));
ALTER TABLE "fees" ADD CONSTRAINT "fees_amount_check" CHECK (amount > 0);
ALTER TABLE "fees" ADD CONSTRAINT "fees_origin_check" CHECK (origin IN ('manual', 'integration'));
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_check" CHECK (type IN ('income', 'expense'));
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_nature_check" CHECK (nature IN ('fixed', 'variable'));
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_check" CHECK (amount > 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_branch_check" CHECK (branch IN ('filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis', 'grupo'));
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_method_check" CHECK (method IN ('pix', 'cash', 'transfer', 'card', 'other'));
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_status_check" CHECK (payment_status IN ('paid', 'pending'));
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_origin_check" CHECK (origin IN ('manual', 'integration', 'sicredi'));
ALTER TABLE "settings" ADD CONSTRAINT "settings_mensalidade_due_day_check" CHECK (mensalidade_due_day BETWEEN 1 AND 31);
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_amount_check" CHECK (amount > 0);
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_type_check" CHECK (type IN ('income', 'expense'));
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_method_check" CHECK (method IN ('pix', 'cash', 'transfer', 'card', 'other'));
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_status_check" CHECK (status IN ('new', 'matched', 'imported'));
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_kind_check" CHECK (kind IN ('charge', 'receipt'));
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_channel_check" CHECK (channel IN ('email', 'whatsapp'));
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_status_check" CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped'));
