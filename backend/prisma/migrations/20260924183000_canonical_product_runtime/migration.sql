-- Runtime cutover: operational tables keep their physical names for history,
-- but every live product relationship points to the canonical public Produto.
ALTER TABLE "quiosque"."CardapioQuiosqueProduto"
  RENAME COLUMN "produtoQuiosqueId" TO "produtoId";

ALTER TABLE "quiosque"."SessaoCaixaProdutoQuiosque"
  RENAME COLUMN "produtoQuiosqueId" TO "produtoId";

ALTER INDEX IF EXISTS "quiosque"."CardapioQuiosqueProduto_cardapioId_produtoQuiosqueId_key"
  RENAME TO "CardapioQuiosqueProduto_cardapioId_produtoId_key";

ALTER INDEX IF EXISTS "quiosque"."SessaoCaixaProdutoQuiosque_sessaoCaixaId_produtoQuiosqueId_key"
  RENAME TO "SessaoCaixaProdutoQuiosque_sessaoCaixaId_produtoId_key";

ALTER TABLE "quiosque"."CardapioQuiosqueProduto"
  DROP CONSTRAINT IF EXISTS "CardapioQuiosqueProduto_produtoQuiosqueId_fkey";
ALTER TABLE "quiosque"."CardapioQuiosqueProduto"
  ADD CONSTRAINT "CardapioQuiosqueProduto_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "public"."Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiosque"."SessaoCaixaProdutoQuiosque"
  DROP CONSTRAINT IF EXISTS "SessaoCaixaProdutoQuiosque_produtoQuiosqueId_fkey";
ALTER TABLE "quiosque"."SessaoCaixaProdutoQuiosque"
  ADD CONSTRAINT "SessaoCaixaProdutoQuiosque_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "public"."Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiosque"."EstoqueSaldoQuiosque"
  DROP CONSTRAINT IF EXISTS "EstoqueSaldoQuiosque_produtoId_fkey";
ALTER TABLE "quiosque"."EstoqueSaldoQuiosque"
  ADD CONSTRAINT "EstoqueSaldoQuiosque_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "public"."Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiosque"."MovimentoEstoqueQuiosque"
  DROP CONSTRAINT IF EXISTS "MovimentoEstoqueQuiosque_produtoId_fkey";
ALTER TABLE "quiosque"."MovimentoEstoqueQuiosque"
  ADD CONSTRAINT "MovimentoEstoqueQuiosque_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "public"."Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
