-- Permite varios ciclos abrir/fechar caixa no mesmo dia (ex.: praia de dia, rua a noite).
DROP INDEX IF EXISTS "quiosque"."SessaoCaixaQuiosque_pontoVendaId_diaOperacional_key";

CREATE INDEX "SessaoCaixaQuiosque_pontoVendaId_diaOperacional_status_idx"
  ON "quiosque"."SessaoCaixaQuiosque"("pontoVendaId", "diaOperacional", "status");
