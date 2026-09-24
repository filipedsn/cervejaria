-- Final contract: all operational product references must resolve to public.Produto.
-- The migration map remains as audit evidence; only the duplicate runtime model
-- and its historical bridge column are removed after DEV reconciliation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."ItemComanda" i
    LEFT JOIN "public"."Produto" p ON p."id" = i."produtoId"
    WHERE i."produtoId" IS NOT NULL AND p."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTRACT: ItemComanda has an orphan canonical product reference';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "public"."ItemComanda"
    WHERE "produtoId" IS NULL AND "produtoQuiosqueId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'CONTRACT: ItemComanda has an unmigrated legacy product reference';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "quiosque"."CardapioQuiosqueProduto" m
    LEFT JOIN "public"."Produto" p ON p."id" = m."produtoId"
    WHERE p."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTRACT: quiosque menu has an orphan canonical product reference';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "quiosque"."SessaoCaixaProdutoQuiosque" s
    LEFT JOIN "public"."Produto" p ON p."id" = s."produtoId"
    WHERE p."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTRACT: cash shift menu has an orphan canonical product reference';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "quiosque"."EstoqueSaldoQuiosque" b
    LEFT JOIN "public"."Produto" p ON p."id" = b."produtoId"
    WHERE p."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTRACT: inventory balance has an orphan canonical product reference';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "quiosque"."MovimentoEstoqueQuiosque" m
    LEFT JOIN "public"."Produto" p ON p."id" = m."produtoId"
    WHERE p."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTRACT: inventory movement has an orphan canonical product reference';
  END IF;
END $$;

ALTER TABLE "public"."ItemComanda"
  DROP CONSTRAINT IF EXISTS "ItemComanda_produtoQuiosqueId_fkey";
DROP INDEX IF EXISTS "public"."ItemComanda_produtoQuiosqueId_idx";
ALTER TABLE "public"."ItemComanda"
  DROP COLUMN "produtoQuiosqueId";

DROP TABLE "quiosque"."ProdutoQuiosque";
