-- A gravação do financeiro recria members/transactions (TRUNCATE). Com estas FKs, o TRUNCATE ... CASCADE
-- apagava toda a fila de mensagens a cada alteração. Os ids continuam gravados; só a FK sai.
ALTER TABLE "message_outbox" DROP CONSTRAINT IF EXISTS "message_outbox_member_id_fkey";
ALTER TABLE "message_outbox" DROP CONSTRAINT IF EXISTS "message_outbox_transaction_id_fkey";
