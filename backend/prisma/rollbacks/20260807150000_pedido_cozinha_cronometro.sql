DROP TABLE IF EXISTS "quiosque"."PedidoQuiosqueStatusHistorico";

ALTER TABLE "quiosque"."PedidoQuiosque"
  DROP COLUMN IF EXISTS "entregueEm",
  DROP COLUMN IF EXISTS "statusDesde";
