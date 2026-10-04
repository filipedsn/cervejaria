-- Contexto historico opcional da ocorrencia para a comanda existente.
-- Block known legacy order/stock parent disagreement before applying any DDL.
-- The migration is intentionally gated until a separately evidenced backfill can assign
-- the kitchen order's PDV; weakening or dropping the final composite FK is not permitted.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "quiosque"."MovimentoEstoqueQuiosque" movement
    JOIN "quiosque"."PedidoQuiosque" order_row ON order_row."id" = movement."pedidoId"
    WHERE movement."pedidoId" IS NOT NULL
      AND (order_row."cervejariaId" IS DISTINCT FROM movement."cervejariaId"
        OR order_row."pontoVendaId" IS DISTINCT FROM movement."pontoVendaId")
  ) THEN
    RAISE EXCEPTION 'PDV_COMMERCE_PREFLIGHT_ORDER_CONTEXT_REQUIRED: stock movement references a kitchen order with missing or incompatible tenant/PDV context';
  END IF;
END $$;

ALTER TABLE "public"."Comanda" ADD COLUMN "ocorrenciaId" TEXT;
CREATE UNIQUE INDEX "OcorrenciaOperacional_pontoVendaId_id_key"
  ON "quiosque"."OcorrenciaOperacional"("pontoVendaId", "id");
ALTER TABLE "public"."Comanda"
  ADD CONSTRAINT "Comanda_pontoVendaId_ocorrenciaId_fkey"
  FOREIGN KEY ("pontoVendaId", "ocorrenciaId")
  REFERENCES "quiosque"."OcorrenciaOperacional"("pontoVendaId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Estoque existente passa a exigir produto e PDV da mesma empresa.
-- Historico nao pode sumir por cascade de exclusao de PDV/produto/pedido.
CREATE UNIQUE INDEX "Produto_id_cervejariaId_key"
  ON "public"."Produto"("id", "cervejariaId");
CREATE UNIQUE INDEX "PedidoQuiosque_id_cervejariaId_pontoVendaId_key"
  ON "quiosque"."PedidoQuiosque"("id", "cervejariaId", "pontoVendaId");

ALTER TABLE "quiosque"."EstoqueSaldoQuiosque"
  DROP CONSTRAINT "EstoqueSaldoQuiosque_pontoVendaId_fkey",
  DROP CONSTRAINT "EstoqueSaldoQuiosque_produtoId_fkey",
  ADD CONSTRAINT "EstoqueSaldoQuiosque_pontoVendaId_cervejariaId_fkey"
    FOREIGN KEY ("pontoVendaId", "cervejariaId")
    REFERENCES "quiosque"."PontoVenda"("id", "cervejariaId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EstoqueSaldoQuiosque_produtoId_cervejariaId_fkey"
    FOREIGN KEY ("produtoId", "cervejariaId")
    REFERENCES "public"."Produto"("id", "cervejariaId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quiosque"."MovimentoEstoqueQuiosque"
  DROP CONSTRAINT "MovimentoEstoqueQuiosque_pontoVendaId_fkey",
  DROP CONSTRAINT "MovimentoEstoqueQuiosque_produtoId_fkey",
  DROP CONSTRAINT "MovimentoEstoqueQuiosque_pedidoId_fkey",
  ADD CONSTRAINT "MovimentoEstoqueQuiosque_pontoVendaId_cervejariaId_fkey"
    FOREIGN KEY ("pontoVendaId", "cervejariaId")
    REFERENCES "quiosque"."PontoVenda"("id", "cervejariaId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MovimentoEstoqueQuiosque_produtoId_cervejariaId_fkey"
    FOREIGN KEY ("produtoId", "cervejariaId")
    REFERENCES "public"."Produto"("id", "cervejariaId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey"
    FOREIGN KEY ("pedidoId", "cervejariaId", "pontoVendaId")
    REFERENCES "quiosque"."PedidoQuiosque"("id", "cervejariaId", "pontoVendaId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
