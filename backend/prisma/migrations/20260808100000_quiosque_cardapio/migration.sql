-- Cardapios reutilizaveis e cardapio operacional por turno de caixa (quiosque)
CREATE TABLE "quiosque"."CardapioQuiosque" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "cervejariaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardapioQuiosque_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quiosque"."CardapioQuiosqueProduto" (
    "id" TEXT NOT NULL,
    "cardapioId" TEXT NOT NULL,
    "produtoQuiosqueId" TEXT NOT NULL,

    CONSTRAINT "CardapioQuiosqueProduto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quiosque"."SessaoCaixaProdutoQuiosque" (
    "id" TEXT NOT NULL,
    "sessaoCaixaId" TEXT NOT NULL,
    "produtoQuiosqueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessaoCaixaProdutoQuiosque_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CardapioQuiosque_cervejariaId_idx" ON "quiosque"."CardapioQuiosque"("cervejariaId");
CREATE UNIQUE INDEX "CardapioQuiosqueProduto_cardapioId_produtoQuiosqueId_key" ON "quiosque"."CardapioQuiosqueProduto"("cardapioId", "produtoQuiosqueId");
CREATE INDEX "CardapioQuiosqueProduto_cardapioId_idx" ON "quiosque"."CardapioQuiosqueProduto"("cardapioId");
CREATE UNIQUE INDEX "SessaoCaixaProdutoQuiosque_sessaoCaixaId_produtoQuiosqueId_key" ON "quiosque"."SessaoCaixaProdutoQuiosque"("sessaoCaixaId", "produtoQuiosqueId");
CREATE INDEX "SessaoCaixaProdutoQuiosque_sessaoCaixaId_idx" ON "quiosque"."SessaoCaixaProdutoQuiosque"("sessaoCaixaId");

ALTER TABLE "quiosque"."CardapioQuiosque" ADD CONSTRAINT "CardapioQuiosque_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "public"."Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiosque"."CardapioQuiosqueProduto" ADD CONSTRAINT "CardapioQuiosqueProduto_cardapioId_fkey" FOREIGN KEY ("cardapioId") REFERENCES "quiosque"."CardapioQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiosque"."CardapioQuiosqueProduto" ADD CONSTRAINT "CardapioQuiosqueProduto_produtoQuiosqueId_fkey" FOREIGN KEY ("produtoQuiosqueId") REFERENCES "quiosque"."ProdutoQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiosque"."SessaoCaixaProdutoQuiosque" ADD CONSTRAINT "SessaoCaixaProdutoQuiosque_sessaoCaixaId_fkey" FOREIGN KEY ("sessaoCaixaId") REFERENCES "quiosque"."SessaoCaixaQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiosque"."SessaoCaixaProdutoQuiosque" ADD CONSTRAINT "SessaoCaixaProdutoQuiosque_produtoQuiosqueId_fkey" FOREIGN KEY ("produtoQuiosqueId") REFERENCES "quiosque"."ProdutoQuiosque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiosque"."SessaoCaixaQuiosque" ADD COLUMN "cardapioQuiosqueId" TEXT;
CREATE INDEX "SessaoCaixaQuiosque_cardapioQuiosqueId_idx" ON "quiosque"."SessaoCaixaQuiosque"("cardapioQuiosqueId");
ALTER TABLE "quiosque"."SessaoCaixaQuiosque" ADD CONSTRAINT "SessaoCaixaQuiosque_cardapioQuiosqueId_fkey" FOREIGN KEY ("cardapioQuiosqueId") REFERENCES "quiosque"."CardapioQuiosque"("id") ON DELETE SET NULL ON UPDATE CASCADE;
