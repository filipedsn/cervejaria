-- TAP-186: opcional do catálogo pode baixar estoque de um produto vinculado.
ALTER TABLE "public"."Opcional"
ADD COLUMN "produtoEstoqueId" TEXT;

CREATE INDEX "Opcional_produtoEstoqueId_idx" ON "public"."Opcional"("produtoEstoqueId");

ALTER TABLE "public"."Opcional"
ADD CONSTRAINT "Opcional_produtoEstoqueId_fkey"
FOREIGN KEY ("produtoEstoqueId") REFERENCES "public"."Produto"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
