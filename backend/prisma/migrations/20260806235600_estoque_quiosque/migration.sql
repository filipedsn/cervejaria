-- CreateEnum
CREATE TYPE "quiosque"."TipoMovimentoEstoqueQuiosque" AS ENUM ('ENTRADA', 'SAIDA_VENDA', 'ESTORNO_VENDA', 'PERDA', 'CORTESIA', 'CONSUMO_INTERNO', 'AJUSTE');

-- CreateTable
CREATE TABLE "quiosque"."EstoqueSaldoQuiosque" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "pontoVendaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstoqueSaldoQuiosque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."MovimentoEstoqueQuiosque" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "pontoVendaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "tipo" "quiosque"."TipoMovimentoEstoqueQuiosque" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "observacao" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "pedidoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoEstoqueQuiosque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstoqueSaldoQuiosque_cervejariaId_pontoVendaId_idx" ON "quiosque"."EstoqueSaldoQuiosque"("cervejariaId", "pontoVendaId");

-- CreateIndex
CREATE UNIQUE INDEX "EstoqueSaldoQuiosque_pontoVendaId_produtoId_key" ON "quiosque"."EstoqueSaldoQuiosque"("pontoVendaId", "produtoId");

-- CreateIndex
CREATE INDEX "MovimentoEstoqueQuiosque_pontoVendaId_produtoId_createdAt_idx" ON "quiosque"."MovimentoEstoqueQuiosque"("pontoVendaId", "produtoId", "createdAt");

-- CreateIndex
CREATE INDEX "MovimentoEstoqueQuiosque_pedidoId_idx" ON "quiosque"."MovimentoEstoqueQuiosque"("pedidoId");

-- AddForeignKey
ALTER TABLE "quiosque"."EstoqueSaldoQuiosque" ADD CONSTRAINT "EstoqueSaldoQuiosque_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."EstoqueSaldoQuiosque" ADD CONSTRAINT "EstoqueSaldoQuiosque_pontoVendaId_fkey" FOREIGN KEY ("pontoVendaId") REFERENCES "quiosque"."PontoVenda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."EstoqueSaldoQuiosque" ADD CONSTRAINT "EstoqueSaldoQuiosque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "quiosque"."ProdutoQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."MovimentoEstoqueQuiosque" ADD CONSTRAINT "MovimentoEstoqueQuiosque_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."MovimentoEstoqueQuiosque" ADD CONSTRAINT "MovimentoEstoqueQuiosque_pontoVendaId_fkey" FOREIGN KEY ("pontoVendaId") REFERENCES "quiosque"."PontoVenda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."MovimentoEstoqueQuiosque" ADD CONSTRAINT "MovimentoEstoqueQuiosque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "quiosque"."ProdutoQuiosque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."MovimentoEstoqueQuiosque" ADD CONSTRAINT "MovimentoEstoqueQuiosque_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "quiosque"."PedidoQuiosque"("id") ON DELETE SET NULL ON UPDATE CASCADE;
