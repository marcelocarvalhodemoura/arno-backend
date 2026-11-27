-- Data efetiva da saída/retorno, tipo de desligamento e trilha de correções da data.
ALTER TABLE "member_status_history"
    ADD COLUMN "effective_date" DATE,
    ADD COLUMN "kind" TEXT,
    ADD COLUMN "confirmed_by" TEXT,
    ADD COLUMN "corrections" JSONB NOT NULL DEFAULT '[]';
