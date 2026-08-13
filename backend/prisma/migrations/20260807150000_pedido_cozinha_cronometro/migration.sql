-- Cronometro da cozinha: statusDesde reinicia a cada fase; entregueEm congela o total.
ALTER TABLE "quiosque"."PedidoQuiosque"
  ADD COLUMN "statusDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "entregueEm" TIMESTAMP(3);

UPDATE "quiosque"."PedidoQuiosque"
SET "statusDesde" = "createdAt",
    "entregueEm" = CASE WHEN "status" = 'ENTREGUE' THEN "updatedAt" ELSE NULL END;

CREATE TABLE "quiosque"."PedidoQuiosqueStatusHistorico" (
  "id" TEXT NOT NULL,
  "pedidoId" TEXT NOT NULL,
  "status" "quiosque"."StatusPedidoQuiosque" NOT NULL,
  "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PedidoQuiosqueStatusHistorico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PedidoQuiosqueStatusHistorico_pedidoId_registradoEm_idx"
  ON "quiosque"."PedidoQuiosqueStatusHistorico"("pedidoId", "registradoEm");

ALTER TABLE "quiosque"."PedidoQuiosqueStatusHistorico"
  ADD CONSTRAINT "PedidoQuiosqueStatusHistorico_pedidoId_fkey"
  FOREIGN KEY ("pedidoId") REFERENCES "quiosque"."PedidoQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Historico inicial para pedidos existentes (status atual na data de criacao).
INSERT INTO "quiosque"."PedidoQuiosqueStatusHistorico" ("id", "pedidoId", "status", "registradoEm")
SELECT
  'mig_' || "id",
  "id",
  "status",
  "createdAt"
FROM "quiosque"."PedidoQuiosque";
