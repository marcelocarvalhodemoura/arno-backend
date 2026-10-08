-- Linha original do extrato: a reimportação compara por ela, porque conciliar/editar muda data e histórico.
ALTER TABLE "transactions" ADD COLUMN "source_date" DATE;
ALTER TABLE "transactions" ADD COLUMN "source_description" TEXT;
ALTER TABLE "transactions" ADD COLUMN "source_amount" DECIMAL(12,2);
