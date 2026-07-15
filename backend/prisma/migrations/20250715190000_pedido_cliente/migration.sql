-- CreateEnum
CREATE TYPE "PedidoClienteStatus" AS ENUM ('PENDENTE', 'CONFIRMADO', 'RECUSADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "PedidoCliente" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "status" "PedidoClienteStatus" NOT NULL DEFAULT 'PENDENTE',
    "observacao" TEXT,
    "recusadoMotivo" TEXT,
    "confirmadoPorId" TEXT,
    "confirmadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedidoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoClienteItem" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "tapId" TEXT,
    "volumeMl" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "precoUnit" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PedidoClienteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PedidoCliente_eventoId_status_idx" ON "PedidoCliente"("eventoId", "status");

-- CreateIndex
CREATE INDEX "PedidoCliente_comandaId_idx" ON "PedidoCliente"("comandaId");

-- CreateIndex
CREATE INDEX "PedidoCliente_clienteId_idx" ON "PedidoCliente"("clienteId");

-- CreateIndex
CREATE INDEX "PedidoClienteItem_pedidoId_idx" ON "PedidoClienteItem"("pedidoId");

-- AddForeignKey
ALTER TABLE "PedidoCliente" ADD CONSTRAINT "PedidoCliente_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "Evento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoCliente" ADD CONSTRAINT "PedidoCliente_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "Comanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoCliente" ADD CONSTRAINT "PedidoCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoCliente" ADD CONSTRAINT "PedidoCliente_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoClienteItem" ADD CONSTRAINT "PedidoClienteItem_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "PedidoCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoClienteItem" ADD CONSTRAINT "PedidoClienteItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
