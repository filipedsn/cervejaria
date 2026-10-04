-- The existing Por Caixa payment column becomes the common session link.
-- Retain sessaoCaixaEventoId as the immutable legacy origin during transition.
ALTER TABLE "public"."Pagamento"
  ADD CONSTRAINT "Pagamento_sessaoCaixaId_fkey"
  FOREIGN KEY ("sessaoCaixaId") REFERENCES "quiosque"."SessaoCaixaQuiosque"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Neither the retained legacy movement nor its mapped common movement may be
-- deleted indirectly by deleting a cash session.
ALTER TABLE "public"."MovimentoCaixaEvento"
  DROP CONSTRAINT "MovimentoCaixaEvento_sessaoId_fkey",
  ADD CONSTRAINT "MovimentoCaixaEvento_sessaoId_fkey"
  FOREIGN KEY ("sessaoId") REFERENCES "public"."SessaoCaixaEvento"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quiosque"."MovimentoCaixaQuiosque"
  DROP CONSTRAINT "MovimentoCaixaQuiosque_sessaoId_fkey",
  ADD CONSTRAINT "MovimentoCaixaQuiosque_sessaoId_fkey"
  FOREIGN KEY ("sessaoId") REFERENCES "quiosque"."SessaoCaixaQuiosque"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
