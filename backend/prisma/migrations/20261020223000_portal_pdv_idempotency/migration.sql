CREATE TABLE "quiosque"."PortalPedidoOperacaoRequest" (
    "idempotencyKey" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalPedidoOperacaoRequest_pkey" PRIMARY KEY ("idempotencyKey")
);

CREATE INDEX "PortalPedidoOperacaoRequest_comandaId_createdAt_idx"
ON "quiosque"."PortalPedidoOperacaoRequest"("comandaId", "createdAt");
