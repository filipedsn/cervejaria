-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "pontoVendaId" TEXT;

-- AlterTable
ALTER TABLE "Opcional" ADD COLUMN     "pontoVendaId" TEXT;

-- AlterTable
ALTER TABLE "ProdutoOpcionalVinculo" ADD COLUMN     "cervejariaId" TEXT,
ADD COLUMN     "pontoVendaId" TEXT;

-- AlterTable
ALTER TABLE "Cardapio" ADD COLUMN     "pontoVendaId" TEXT;

-- AlterTable
ALTER TABLE "CardapioProduto" ADD COLUMN     "cervejariaId" TEXT,
ADD COLUMN     "pontoVendaId" TEXT;

-- AlterTable
ALTER TABLE "quiosque"."PdvMigrationMap" ADD COLUMN     "sourcePayload" JSONB;

-- CreateTable
CREATE TABLE "quiosque"."ConfiguracaoPontoVenda" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "pontoVendaId" TEXT NOT NULL,
    "tapsEnabled" BOOLEAN NOT NULL,
    "inventoryEnabled" BOOLEAN NOT NULL,
    "kitchenEnabled" BOOLEAN NOT NULL,
    "kitchenItemsChargeAtLaunch" BOOLEAN NOT NULL,
    "allowCloseComandaWithPendingKitchenOrders" BOOLEAN NOT NULL,
    "whatsappPedidoProntoEnabled" BOOLEAN NOT NULL,
    "whatsappPedidoProntoNaCozinha" BOOLEAN NOT NULL,
    "quantidadeMesas" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoPontoVenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracaoPontoVenda_pontoVendaId_key" ON "quiosque"."ConfiguracaoPontoVenda"("pontoVendaId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracaoPontoVenda_id_cervejariaId_pontoVendaId_key" ON "quiosque"."ConfiguracaoPontoVenda"("id", "cervejariaId", "pontoVendaId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracaoPontoVenda_pontoVendaId_cervejariaId_key" ON "quiosque"."ConfiguracaoPontoVenda"("pontoVendaId", "cervejariaId");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_id_cervejariaId_pontoVendaId_key" ON "Produto"("id", "cervejariaId", "pontoVendaId");

-- CreateIndex
CREATE UNIQUE INDEX "Opcional_id_cervejariaId_pontoVendaId_key" ON "Opcional"("id", "cervejariaId", "pontoVendaId");

-- CreateIndex
CREATE UNIQUE INDEX "Cardapio_id_cervejariaId_pontoVendaId_key" ON "Cardapio"("id", "cervejariaId", "pontoVendaId");

-- AddForeignKey
ALTER TABLE "quiosque"."ConfiguracaoPontoVenda" ADD CONSTRAINT "ConfiguracaoPontoVenda_pontoVendaId_cervejariaId_fkey" FOREIGN KEY ("pontoVendaId", "cervejariaId") REFERENCES "quiosque"."PontoVenda"("id", "cervejariaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_pontoVendaId_cervejariaId_fkey" FOREIGN KEY ("pontoVendaId", "cervejariaId") REFERENCES "quiosque"."PontoVenda"("id", "cervejariaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opcional" ADD CONSTRAINT "Opcional_pontoVendaId_cervejariaId_fkey" FOREIGN KEY ("pontoVendaId", "cervejariaId") REFERENCES "quiosque"."PontoVenda"("id", "cervejariaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoOpcionalVinculo" ADD CONSTRAINT "ProdutoOpcionalVinculo_produtoId_cervejariaId_pontoVendaId_fkey" FOREIGN KEY ("produtoId", "cervejariaId", "pontoVendaId") REFERENCES "Produto"("id", "cervejariaId", "pontoVendaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoOpcionalVinculo" ADD CONSTRAINT "ProdutoOpcionalVinculo_opcionalId_cervejariaId_pontoVendaI_fkey" FOREIGN KEY ("opcionalId", "cervejariaId", "pontoVendaId") REFERENCES "Opcional"("id", "cervejariaId", "pontoVendaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cardapio" ADD CONSTRAINT "Cardapio_pontoVendaId_cervejariaId_fkey" FOREIGN KEY ("pontoVendaId", "cervejariaId") REFERENCES "quiosque"."PontoVenda"("id", "cervejariaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardapioProduto" ADD CONSTRAINT "CardapioProduto_cardapioId_cervejariaId_pontoVendaId_fkey" FOREIGN KEY ("cardapioId", "cervejariaId", "pontoVendaId") REFERENCES "Cardapio"("id", "cervejariaId", "pontoVendaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardapioProduto" ADD CONSTRAINT "CardapioProduto_produtoId_cervejariaId_pontoVendaId_fkey" FOREIGN KEY ("produtoId", "cervejariaId", "pontoVendaId") REFERENCES "Produto"("id", "cervejariaId", "pontoVendaId") ON DELETE RESTRICT ON UPDATE CASCADE;
