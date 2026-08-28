-- Correcao auditavel de sangrias e suprimentos: o movimento original nunca e alterado em valor.
CREATE TYPE "quiosque"."NaturezaCorrecaoMovimentoCaixaQuiosque" AS ENUM ('ESTORNO', 'SUBSTITUICAO');

ALTER TABLE "quiosque"."MovimentoCaixaQuiosque"
  ADD COLUMN "correcaoDeId" TEXT,
  ADD COLUMN "naturezaCorrecao" "quiosque"."NaturezaCorrecaoMovimentoCaixaQuiosque",
  ADD COLUMN "motivoCorrecao" TEXT,
  ADD COLUMN "autorizadoPorId" TEXT,
  ADD COLUMN "solicitadoPorId" TEXT,
  ADD COLUMN "corrigidoEm" TIMESTAMP(3);

CREATE INDEX "MovimentoCaixaQuiosque_correcaoDeId_idx"
  ON "quiosque"."MovimentoCaixaQuiosque"("correcaoDeId");

ALTER TABLE "quiosque"."MovimentoCaixaQuiosque"
  ADD CONSTRAINT "MovimentoCaixaQuiosque_correcaoDeId_fkey"
  FOREIGN KEY ("correcaoDeId") REFERENCES "quiosque"."MovimentoCaixaQuiosque"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TYPE "public"."TransacaoTipo" ADD VALUE 'QUIOSQUE_CAIXA_MOVIMENTO_CORRIGIDO';
