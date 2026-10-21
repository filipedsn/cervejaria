ALTER TABLE "Cervejaria"
ADD COLUMN "portalCategoriasPermitidas" JSONB;

ALTER TABLE "Comanda"
ADD COLUMN "solicitacaoPagamentoEm" TIMESTAMP(3);

ALTER TABLE "PedidoCliente"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "PedidoCliente_idempotencyKey_key"
ON "PedidoCliente"("idempotencyKey");

ALTER TABLE "PedidoClienteItem"
ADD COLUMN "paraViagem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "observacao" TEXT,
ADD COLUMN "opcionais" JSONB;
