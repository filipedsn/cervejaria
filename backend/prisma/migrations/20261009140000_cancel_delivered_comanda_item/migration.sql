CREATE TABLE "public"."ItemComandaCancelamentoEntregue" (
  "id" TEXT NOT NULL,
  "itemComandaId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "cervejariaId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "quantidade" INTEGER NOT NULL,
  "valorRetirado" DECIMAL(10,2) NOT NULL,
  "motivo" TEXT NOT NULL,
  "tratamentoEstoque" TEXT NOT NULL,
  "resultado" TEXT NOT NULL DEFAULT 'SUCESSO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ItemComandaCancelamentoEntregue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ItemComandaCancelamentoEntregue_itemComandaId_fkey"
    FOREIGN KEY ("itemComandaId") REFERENCES "public"."ItemComanda"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ItemComandaCancelamentoEntregue_idempotencyKey_key"
  ON "public"."ItemComandaCancelamentoEntregue"("idempotencyKey");
CREATE INDEX "ItemComandaCancelamentoEntregue_itemComandaId_createdAt_idx"
  ON "public"."ItemComandaCancelamentoEntregue"("itemComandaId", "createdAt");
CREATE INDEX "ItemComandaCancelamentoEntregue_cervejariaId_createdAt_idx"
  ON "public"."ItemComandaCancelamentoEntregue"("cervejariaId", "createdAt");
