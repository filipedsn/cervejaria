-- CreateEnum
CREATE TYPE "quiosque"."StatusCaixaQuiosque" AS ENUM ('ABERTO', 'FECHADO');

-- CreateEnum
CREATE TYPE "quiosque"."TipoMovimentoCaixaQuiosque" AS ENUM ('SANGRIA', 'SUPRIMENTO');

-- CreateTable
CREATE TABLE "quiosque"."SessaoCaixaQuiosque" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "pontoVendaId" TEXT NOT NULL,
    "diaOperacional" DATE NOT NULL,
    "status" "quiosque"."StatusCaixaQuiosque" NOT NULL DEFAULT 'ABERTO',
    "trocoInicial" DECIMAL(10,2) NOT NULL,
    "abertoPorId" TEXT NOT NULL,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadoPorId" TEXT,
    "fechadoEm" TIMESTAMP(3),
    "contadoDinheiro" DECIMAL(10,2),
    "contadoPix" DECIMAL(10,2),
    "contadoCartaoDebito" DECIMAL(10,2),
    "contadoCartaoCredito" DECIMAL(10,2),
    "observacaoFechamento" TEXT,

    CONSTRAINT "SessaoCaixaQuiosque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."MovimentoCaixaQuiosque" (
    "id" TEXT NOT NULL,
    "sessaoId" TEXT NOT NULL,
    "tipo" "quiosque"."TipoMovimentoCaixaQuiosque" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "observacao" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoCaixaQuiosque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessaoCaixaQuiosque_cervejariaId_diaOperacional_idx" ON "quiosque"."SessaoCaixaQuiosque"("cervejariaId", "diaOperacional");

-- CreateIndex
CREATE UNIQUE INDEX "SessaoCaixaQuiosque_pontoVendaId_diaOperacional_key" ON "quiosque"."SessaoCaixaQuiosque"("pontoVendaId", "diaOperacional");

-- CreateIndex
CREATE INDEX "MovimentoCaixaQuiosque_sessaoId_idx" ON "quiosque"."MovimentoCaixaQuiosque"("sessaoId");

-- AddForeignKey
ALTER TABLE "quiosque"."SessaoCaixaQuiosque" ADD CONSTRAINT "SessaoCaixaQuiosque_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."SessaoCaixaQuiosque" ADD CONSTRAINT "SessaoCaixaQuiosque_pontoVendaId_fkey" FOREIGN KEY ("pontoVendaId") REFERENCES "quiosque"."PontoVenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."MovimentoCaixaQuiosque" ADD CONSTRAINT "MovimentoCaixaQuiosque_sessaoId_fkey" FOREIGN KEY ("sessaoId") REFERENCES "quiosque"."SessaoCaixaQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;
