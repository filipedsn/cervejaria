ALTER TABLE "quiosque"."SessaoCaixaQuiosque" DROP CONSTRAINT IF EXISTS "SessaoCaixaQuiosque_cardapioQuiosqueId_fkey";
DROP INDEX IF EXISTS "quiosque"."SessaoCaixaQuiosque_cardapioQuiosqueId_idx";
ALTER TABLE "quiosque"."SessaoCaixaQuiosque" DROP COLUMN IF EXISTS "cardapioQuiosqueId";

DROP TABLE IF EXISTS "quiosque"."SessaoCaixaProdutoQuiosque";
DROP TABLE IF EXISTS "quiosque"."CardapioQuiosqueProduto";
DROP TABLE IF EXISTS "quiosque"."CardapioQuiosque";
