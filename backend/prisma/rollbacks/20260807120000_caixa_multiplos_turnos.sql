DROP INDEX IF EXISTS "quiosque"."SessaoCaixaQuiosque_pontoVendaId_diaOperacional_status_idx";

CREATE UNIQUE INDEX "SessaoCaixaQuiosque_pontoVendaId_diaOperacional_key"
  ON "quiosque"."SessaoCaixaQuiosque"("pontoVendaId", "diaOperacional");
