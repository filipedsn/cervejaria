-- Reverte a Fase 5 (estoque) do modulo Quiosque.
-- Vendas, caixa e catalogo (Fases 2–4) permanecem intactos.

DROP TABLE IF EXISTS "quiosque"."MovimentoEstoqueQuiosque";
DROP TABLE IF EXISTS "quiosque"."EstoqueSaldoQuiosque";

DROP TYPE IF EXISTS "quiosque"."TipoMovimentoEstoqueQuiosque";
