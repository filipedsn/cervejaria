ALTER TYPE "public"."TransacaoTipo"
  ADD VALUE 'CASH_REGISTER_ADMINISTRATIVE_CLOSED';

CREATE TYPE "quiosque"."TipoEncerramentoSessaoCaixa" AS ENUM (
  'FINANCEIRO',
  'ADMINISTRATIVO'
);

ALTER TABLE "quiosque"."SessaoCaixaQuiosque"
  ADD COLUMN "tipoEncerramento" "quiosque"."TipoEncerramentoSessaoCaixa";
