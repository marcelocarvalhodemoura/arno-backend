-- Última mensagem recebida de cada número no WhatsApp. A Meta só aceita texto livre
-- (e não cobra) até 24 h depois da última mensagem da pessoa; fora disso o envio é pago.
CREATE TABLE "whatsapp_contacts" (
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "last_inbound_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("phone")
);
