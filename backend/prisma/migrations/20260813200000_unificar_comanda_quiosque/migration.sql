-- Unifica ComandaQuiosque em public.Comanda (origem QUIOSQUE)
-- Enum ComandaOrigem + ComandaTipo (MESA/FICHA/APELIDO) em 20260813194500_comanda_quiosque_enums

ALTER TABLE "public"."Comanda"
  ADD COLUMN "origem" "public"."ComandaOrigem" NOT NULL DEFAULT 'EVENTO',
  ADD COLUMN "pontoVendaId" TEXT,
  ADD COLUMN "diaOperacional" DATE,
  ADD COLUMN "identificador" TEXT,
  ADD COLUMN "abertaPorId" TEXT;

ALTER TABLE "public"."Comanda" ALTER COLUMN "eventoId" DROP NOT NULL;
ALTER TABLE "public"."Comanda" ALTER COLUMN "clienteId" DROP NOT NULL;

ALTER TABLE "public"."ItemComanda"
  ADD COLUMN "produtoQuiosqueId" TEXT,
  ADD COLUMN "nome" TEXT,
  ADD COLUMN "exigePreparo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pedidoCozinhaId" TEXT;

ALTER TABLE "public"."ItemComanda" ALTER COLUMN "produtoId" DROP NOT NULL;
ALTER TABLE "public"."ItemComanda" ALTER COLUMN "volumeMl" SET DEFAULT 0;

ALTER TABLE "public"."Pagamento"
  ADD COLUMN "valorRecebido" DECIMAL(10,2),
  ADD COLUMN "troco" DECIMAL(10,2),
  ADD COLUMN "registradoPorId" TEXT;

-- Migrar comandas do quiosque (preserva ids para FK de PedidoQuiosque)
INSERT INTO "public"."Comanda" (
  "id",
  "origem",
  "status",
  "tipo",
  "numero",
  "desconto",
  "total",
  "fechadoPorId",
  "fechadaEm",
  "pontoVendaId",
  "diaOperacional",
  "identificador",
  "abertaPorId",
  "createdAt",
  "updatedAt"
)
SELECT
  cq."id",
  'QUIOSQUE'::"public"."ComandaOrigem",
  cq."status"::text::"public"."ComandaStatus",
  cq."tipo"::text::"public"."ComandaTipo",
  cq."numero",
  cq."desconto",
  GREATEST(
    0,
    COALESCE(sub."subtotal", 0) - cq."desconto"
  ),
  cq."fechadaPorId",
  cq."fechadaEm",
  cq."pontoVendaId",
  cq."diaOperacional",
  cq."identificador",
  cq."abertaPorId",
  cq."createdAt",
  cq."updatedAt"
FROM "quiosque"."ComandaQuiosque" cq
LEFT JOIN (
  SELECT
    p."comandaId",
    SUM(i."precoUnit" * i."quantidade") AS "subtotal"
  FROM "quiosque"."PedidoQuiosque" p
  JOIN "quiosque"."ItemPedidoQuiosque" i ON i."pedidoId" = p."id"
  WHERE p."status" <> 'CANCELADO'
  GROUP BY p."comandaId"
) sub ON sub."comandaId" = cq."id"
ON CONFLICT ("id") DO NOTHING;

-- Migrar itens para ItemComanda
INSERT INTO "public"."ItemComanda" (
  "id",
  "comandaId",
  "produtoQuiosqueId",
  "volumeMl",
  "quantidade",
  "precoUnit",
  "nome",
  "exigePreparo",
  "pedidoCozinhaId",
  "createdAt"
)
SELECT
  i."id",
  p."comandaId",
  i."produtoId",
  0,
  i."quantidade",
  i."precoUnit",
  i."nome",
  i."exigePreparo",
  p."id",
  p."createdAt"
FROM "quiosque"."ItemPedidoQuiosque" i
JOIN "quiosque"."PedidoQuiosque" p ON p."id" = i."pedidoId"
WHERE p."status" <> 'CANCELADO'
ON CONFLICT ("id") DO NOTHING;

-- Migrar pagamentos
INSERT INTO "public"."Pagamento" (
  "id",
  "comandaId",
  "forma",
  "valor",
  "valorRecebido",
  "troco",
  "registradoPorId",
  "pagoEm"
)
SELECT
  pq."id",
  pq."comandaId",
  pq."forma"::text::"public"."PaymentMethod",
  pq."valor",
  pq."valorRecebido",
  pq."troco",
  pq."registradoPorId",
  pq."pagoEm"
FROM "quiosque"."PagamentoQuiosque" pq
ON CONFLICT ("id") DO NOTHING;

-- FKs e índices
CREATE INDEX "Comanda_origem_status_createdAt_idx" ON "public"."Comanda"("origem", "status", "createdAt");
CREATE INDEX "Comanda_pontoVendaId_status_idx" ON "public"."Comanda"("pontoVendaId", "status");
CREATE INDEX "Comanda_origem_diaOperacional_idx" ON "public"."Comanda"("origem", "diaOperacional");
CREATE INDEX "ItemComanda_produtoQuiosqueId_idx" ON "public"."ItemComanda"("produtoQuiosqueId");
CREATE INDEX "ItemComanda_pedidoCozinhaId_idx" ON "public"."ItemComanda"("pedidoCozinhaId");

ALTER TABLE "public"."Comanda"
  ADD CONSTRAINT "Comanda_pontoVendaId_fkey"
  FOREIGN KEY ("pontoVendaId") REFERENCES "quiosque"."PontoVenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."ItemComanda"
  ADD CONSTRAINT "ItemComanda_produtoQuiosqueId_fkey"
  FOREIGN KEY ("produtoQuiosqueId") REFERENCES "quiosque"."ProdutoQuiosque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."ItemComanda"
  ADD CONSTRAINT "ItemComanda_pedidoCozinhaId_fkey"
  FOREIGN KEY ("pedidoCozinhaId") REFERENCES "quiosque"."PedidoQuiosque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quiosque"."PedidoQuiosque" DROP CONSTRAINT IF EXISTS "PedidoQuiosque_comandaId_fkey";

ALTER TABLE "quiosque"."PedidoQuiosque"
  ADD CONSTRAINT "PedidoQuiosque_comandaId_fkey"
  FOREIGN KEY ("comandaId") REFERENCES "public"."Comanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE IF EXISTS "quiosque"."ItemPedidoQuiosque";
DROP TABLE IF EXISTS "quiosque"."PagamentoQuiosque";
DROP TABLE IF EXISTS "quiosque"."ComandaQuiosque";
