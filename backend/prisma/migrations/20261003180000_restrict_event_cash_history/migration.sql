-- Protect cash history even if a caller bypasses the application lock.
-- PostgreSQL validates the existing rows when adding the new FK.
ALTER TABLE "public"."SessaoCaixaEvento"
  DROP CONSTRAINT "SessaoCaixaEvento_eventoId_fkey";

ALTER TABLE "public"."SessaoCaixaEvento"
  ADD CONSTRAINT "SessaoCaixaEvento_eventoId_fkey"
  FOREIGN KEY ("eventoId") REFERENCES "public"."Evento"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
