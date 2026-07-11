-- Cardápios reutilizáveis e vínculo opcional no evento
CREATE TABLE "Cardapio" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "cervejariaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cardapio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CardapioProduto" (
    "id" TEXT NOT NULL,
    "cardapioId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,

    CONSTRAINT "CardapioProduto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Cardapio_cervejariaId_idx" ON "Cardapio"("cervejariaId");
CREATE UNIQUE INDEX "CardapioProduto_cardapioId_produtoId_key" ON "CardapioProduto"("cardapioId", "produtoId");
CREATE INDEX "CardapioProduto_cardapioId_idx" ON "CardapioProduto"("cardapioId");

ALTER TABLE "Cardapio" ADD CONSTRAINT "Cardapio_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CardapioProduto" ADD CONSTRAINT "CardapioProduto_cardapioId_fkey" FOREIGN KEY ("cardapioId") REFERENCES "Cardapio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CardapioProduto" ADD CONSTRAINT "CardapioProduto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Evento" ADD COLUMN "cardapioId" TEXT;
CREATE INDEX "Evento_cardapioId_idx" ON "Evento"("cardapioId");
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_cardapioId_fkey" FOREIGN KEY ("cardapioId") REFERENCES "Cardapio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
