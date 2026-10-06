ALTER TABLE "quiosque"."SessaoCaixaQuiosque"
ADD CONSTRAINT "SessaoCaixaQuiosque_pontoVendaId_id_key"
UNIQUE ("pontoVendaId", "id");

ALTER TABLE "public"."Comanda"
ADD COLUMN "sessaoCaixaRealizacaoId" TEXT;

ALTER TABLE "public"."Comanda"
ADD CONSTRAINT "Comanda_sessaoRealizacao_requer_ponto_check"
CHECK ("sessaoCaixaRealizacaoId" IS NULL OR "pontoVendaId" IS NOT NULL);

CREATE INDEX "Comanda_sessaoCaixaRealizacaoId_idx"
ON "public"."Comanda"("pontoVendaId", "sessaoCaixaRealizacaoId");

ALTER TABLE "public"."Comanda"
ADD CONSTRAINT "Comanda_pontoVendaId_sessaoCaixaRealizacaoId_fkey"
FOREIGN KEY ("pontoVendaId", "sessaoCaixaRealizacaoId")
REFERENCES "quiosque"."SessaoCaixaQuiosque"("pontoVendaId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "public"."Comanda"
VALIDATE CONSTRAINT "Comanda_pontoVendaId_sessaoCaixaRealizacaoId_fkey";
