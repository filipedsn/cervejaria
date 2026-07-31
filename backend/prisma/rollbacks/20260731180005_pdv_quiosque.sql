-- Reverte a Fase 2 (PDV) do modulo Quiosque.
-- Apaga vendas, comandas e pagamentos do quiosque. O catalogo, os pontos de
-- venda e a configuracao do modulo (Fase 1) continuam intactos.

DROP TABLE IF EXISTS "quiosque"."PagamentoQuiosque";
DROP TABLE IF EXISTS "quiosque"."ItemPedidoQuiosque";
DROP TABLE IF EXISTS "quiosque"."PedidoQuiosque";
DROP TABLE IF EXISTS "quiosque"."ComandaQuiosque";

DROP TYPE IF EXISTS "quiosque"."FormaPagamentoQuiosque";
DROP TYPE IF EXISTS "quiosque"."StatusPedidoQuiosque";
DROP TYPE IF EXISTS "quiosque"."StatusComandaQuiosque";
DROP TYPE IF EXISTS "quiosque"."TipoComandaQuiosque";
