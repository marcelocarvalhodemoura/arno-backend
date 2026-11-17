-- Tabelas financeiras criadas depois de finance_version (histórico de status e divisão da mensalidade)
-- também mudam a versão do financeiro, para o cache de outra instância da API não ficar velho.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['member_status_history', 'mensalidade_allocations'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION bump_finance_version()',
      t || '_bump_finance_version', t
    );
  END LOOP;
END $$;
