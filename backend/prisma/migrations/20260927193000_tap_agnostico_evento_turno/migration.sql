-- Torna a montagem do Tap reutilizavel por evento ou sessao de caixa.
-- Registros historicos de eventos continuam preservados.
BEGIN;

ALTER TABLE "quiosque"."SessaoCaixaQuiosque"
  ADD COLUMN "trailerId" TEXT;

ALTER TABLE "quiosque"."SessaoCaixaQuiosque"
  ADD CONSTRAINT "SessaoCaixaQuiosque_trailerId_fkey"
  FOREIGN KEY ("trailerId") REFERENCES "public"."Trailer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SessaoCaixaQuiosque_trailerId_idx"
  ON "quiosque"."SessaoCaixaQuiosque"("trailerId");

ALTER TABLE "public"."TapMontagem"
  ALTER COLUMN "eventoId" DROP NOT NULL,
  ADD COLUMN "sessaoCaixaId" TEXT;

ALTER TABLE "public"."TapMontagem"
  ADD CONSTRAINT "TapMontagem_sessaoCaixaId_fkey"
  FOREIGN KEY ("sessaoCaixaId") REFERENCES "quiosque"."SessaoCaixaQuiosque"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TapMontagem_sessaoCaixaId_encerradoEm_idx"
  ON "public"."TapMontagem"("sessaoCaixaId", "encerradoEm");

CREATE INDEX "TapMontagem_tapId_sessaoCaixaId_idx"
  ON "public"."TapMontagem"("tapId", "sessaoCaixaId");

ALTER TABLE "public"."TapMontagem"
  ADD CONSTRAINT "TapMontagem_contexto_check"
  CHECK (("eventoId" IS NOT NULL AND "sessaoCaixaId" IS NULL)
      OR ("eventoId" IS NULL AND "sessaoCaixaId" IS NOT NULL));

COMMIT;
