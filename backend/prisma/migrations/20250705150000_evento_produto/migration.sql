-- Comida e bebidas disponíveis por evento (cardápio operacional)
CREATE TABLE "EventoProduto" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoProduto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventoProduto_eventoId_produtoId_key" ON "EventoProduto"("eventoId", "produtoId");
CREATE INDEX "EventoProduto_eventoId_idx" ON "EventoProduto"("eventoId");

ALTER TABLE "EventoProduto" ADD CONSTRAINT "EventoProduto_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "Evento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventoProduto" ADD CONSTRAINT "EventoProduto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
