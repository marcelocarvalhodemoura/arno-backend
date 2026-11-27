-- Pergunta de permanência à família (possível desligamento) passa pela mesma fila de mensagens.
ALTER TABLE "message_outbox" DROP CONSTRAINT "message_outbox_kind_check";
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_kind_check" CHECK (kind IN ('charge', 'receipt', 'departure_check'));
