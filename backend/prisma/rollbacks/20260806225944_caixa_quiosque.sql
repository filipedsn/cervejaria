-- Reverte a Fase 4 (caixa diario) do modulo Quiosque.
-- Vendas, comandas e pagamentos (Fase 2) permanecem intactos.

DROP TABLE IF EXISTS "quiosque"."MovimentoCaixaQuiosque";
DROP TABLE IF EXISTS "quiosque"."SessaoCaixaQuiosque";

DROP TYPE IF EXISTS "quiosque"."TipoMovimentoCaixaQuiosque";
DROP TYPE IF EXISTS "quiosque"."StatusCaixaQuiosque";
