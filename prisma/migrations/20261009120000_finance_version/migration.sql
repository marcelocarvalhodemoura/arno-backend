-- Versão do financeiro: muda a cada escrita em qualquer tabela financeira, por qualquer caminho
-- (API, scripts, SQL manual). A API usa para saber se o financeiro em cache ainda vale.
CREATE TABLE "finance_version" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "version" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "finance_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_version_single_row" CHECK ("id" = 1)
);

INSERT INTO "finance_version" ("id", "version") VALUES (1, 0);

CREATE FUNCTION bump_finance_version() RETURNS trigger AS $$
BEGIN
  UPDATE "finance_version" SET "version" = "version" + 1 WHERE "id" = 1;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transactions', 'member_arrears', 'member_siblings', 'member_guardians', 'member_accounts',
    'project_items', 'projects', 'members', 'movement_types', 'fees', 'settings',
    'transaction_trash', 'month_closings', 'fee_schedule_periods'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION bump_finance_version()',
      t || '_bump_finance_version', t
    );
  END LOOP;
END $$;
