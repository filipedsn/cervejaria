CREATE TYPE "public"."PaymentHistoricalProvenance" AS ENUM ('CAIXA_NAO_COMPROVADA');

ALTER TABLE "public"."Pagamento"
ADD COLUMN "provenienciaHistorica" "public"."PaymentHistoricalProvenance";

ALTER TABLE "public"."Pagamento"
ADD CONSTRAINT "Pagamento_provenienciaHistorica_sem_sessao_check"
CHECK (
  "provenienciaHistorica" IS NULL
  OR ("sessaoCaixaId" IS NULL AND "sessaoCaixaEventoId" IS NULL AND "contaReceberId" IS NULL)
);
