-- Jovens até sênior usam o e-mail do responsável, então irmãos compartilham o mesmo e-mail.
DROP INDEX "members_email_key";

CREATE INDEX "members_email_idx" ON "members"("email");
