-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "quiosque";

-- CreateTable
CREATE TABLE "quiosque"."ConfiguracaoQuiosque" (
    "cervejariaId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "controlaEstoque" BOOLEAN NOT NULL DEFAULT false,
    "temCozinha" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoQuiosque_pkey" PRIMARY KEY ("cervejariaId")
);

-- CreateTable
CREATE TABLE "quiosque"."PontoVenda" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PontoVenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."ProdutoQuiosque" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT,
    "precoUnit" DECIMAL(10,2) NOT NULL,
    "exigePreparo" BOOLEAN NOT NULL DEFAULT false,
    "controlaEstoque" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProdutoQuiosque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PontoVenda_cervejariaId_ativo_idx" ON "quiosque"."PontoVenda"("cervejariaId", "ativo");

-- CreateIndex
CREATE INDEX "ProdutoQuiosque_cervejariaId_ativo_ordem_idx" ON "quiosque"."ProdutoQuiosque"("cervejariaId", "ativo", "ordem");

-- AddForeignKey
ALTER TABLE "quiosque"."ConfiguracaoQuiosque" ADD CONSTRAINT "ConfiguracaoQuiosque_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PontoVenda" ADD CONSTRAINT "PontoVenda_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."ProdutoQuiosque" ADD CONSTRAINT "ProdutoQuiosque_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
