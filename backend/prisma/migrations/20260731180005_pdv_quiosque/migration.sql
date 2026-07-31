-- CreateEnum
CREATE TYPE "quiosque"."TipoComandaQuiosque" AS ENUM ('AVULSA', 'APELIDO', 'MESA', 'FICHA');

-- CreateEnum
CREATE TYPE "quiosque"."StatusComandaQuiosque" AS ENUM ('ABERTA', 'FECHADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "quiosque"."StatusPedidoQuiosque" AS ENUM ('RECEBIDO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO');

-- CreateEnum
CREATE TYPE "quiosque"."FormaPagamentoQuiosque" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO');

-- CreateTable
CREATE TABLE "quiosque"."ComandaQuiosque" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "pontoVendaId" TEXT NOT NULL,
    "tipo" "quiosque"."TipoComandaQuiosque" NOT NULL,
    "identificador" TEXT,
    "status" "quiosque"."StatusComandaQuiosque" NOT NULL DEFAULT 'ABERTA',
    "diaOperacional" DATE NOT NULL,
    "abertaPorId" TEXT NOT NULL,
    "fechadaPorId" TEXT,
    "fechadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComandaQuiosque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."PedidoQuiosque" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "pontoVendaId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "diaOperacional" DATE NOT NULL,
    "status" "quiosque"."StatusPedidoQuiosque" NOT NULL DEFAULT 'RECEBIDO',
    "observacao" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedidoQuiosque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."ItemPedidoQuiosque" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "precoUnit" DECIMAL(10,2) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "exigePreparo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ItemPedidoQuiosque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."PagamentoQuiosque" (
    "id" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "forma" "quiosque"."FormaPagamentoQuiosque" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "valorRecebido" DECIMAL(10,2),
    "troco" DECIMAL(10,2),
    "registradoPorId" TEXT NOT NULL,
    "pagoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagamentoQuiosque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComandaQuiosque_cervejariaId_status_createdAt_idx" ON "quiosque"."ComandaQuiosque"("cervejariaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ComandaQuiosque_cervejariaId_diaOperacional_idx" ON "quiosque"."ComandaQuiosque"("cervejariaId", "diaOperacional");

-- CreateIndex
CREATE INDEX "ComandaQuiosque_pontoVendaId_status_idx" ON "quiosque"."ComandaQuiosque"("pontoVendaId", "status");

-- CreateIndex
CREATE INDEX "PedidoQuiosque_cervejariaId_status_createdAt_idx" ON "quiosque"."PedidoQuiosque"("cervejariaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PedidoQuiosque_comandaId_idx" ON "quiosque"."PedidoQuiosque"("comandaId");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoQuiosque_cervejariaId_diaOperacional_numero_key" ON "quiosque"."PedidoQuiosque"("cervejariaId", "diaOperacional", "numero");

-- CreateIndex
CREATE INDEX "ItemPedidoQuiosque_pedidoId_idx" ON "quiosque"."ItemPedidoQuiosque"("pedidoId");

-- CreateIndex
CREATE INDEX "PagamentoQuiosque_comandaId_idx" ON "quiosque"."PagamentoQuiosque"("comandaId");

-- AddForeignKey
ALTER TABLE "quiosque"."ComandaQuiosque" ADD CONSTRAINT "ComandaQuiosque_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."ComandaQuiosque" ADD CONSTRAINT "ComandaQuiosque_pontoVendaId_fkey" FOREIGN KEY ("pontoVendaId") REFERENCES "quiosque"."PontoVenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PedidoQuiosque" ADD CONSTRAINT "PedidoQuiosque_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PedidoQuiosque" ADD CONSTRAINT "PedidoQuiosque_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "quiosque"."ComandaQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PedidoQuiosque" ADD CONSTRAINT "PedidoQuiosque_pontoVendaId_fkey" FOREIGN KEY ("pontoVendaId") REFERENCES "quiosque"."PontoVenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."ItemPedidoQuiosque" ADD CONSTRAINT "ItemPedidoQuiosque_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "quiosque"."PedidoQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."ItemPedidoQuiosque" ADD CONSTRAINT "ItemPedidoQuiosque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "quiosque"."ProdutoQuiosque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PagamentoQuiosque" ADD CONSTRAINT "PagamentoQuiosque_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "quiosque"."ComandaQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;
