-- Guarded rollback restores only values still equal to the transformation result.
BEGIN;
LOCK TABLE "Produto", "CategoriaProdutoPdv", "PdvCategoriaTransformacaoProduto", "PdvCategoriaTransformacaoCategoria" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PdvCategoriaTransformacaoProduto" e
    LEFT JOIN "Produto" p ON p."id" = e."produtoId" AND p."cervejariaId" = e."cervejariaId"
    WHERE e."transformacao" = 'categoria-historica-v2'
      AND (p."id" IS NULL OR p."categoria" IS DISTINCT FROM e."categoriaDepois"
        OR p."categoriaPdvId" IS DISTINCT FROM e."categoriaPdvIdDepois")
  ) THEN RAISE EXCEPTION 'Rollback blocked: product changed or removed after transform; inspect v2 provenance.'; END IF;

  IF EXISTS (
    SELECT 1 FROM "PdvCategoriaTransformacaoCategoria" e
    LEFT JOIN "CategoriaProdutoPdv" c ON c."id" = e."categoriaPdvId" AND c."cervejariaId" = e."cervejariaId"
    WHERE e."transformacao" = 'categoria-historica-v2'
      AND (c."id" IS NULL OR c."nome" IS DISTINCT FROM e."nome"
        OR c."nomeNormalizado" IS DISTINCT FROM e."nomeNormalizado"
        OR c."gamificada" IS DISTINCT FROM e."gamificada"
        OR c."origemMigracao" IS DISTINCT FROM e."origemMigracao")
  ) THEN RAISE EXCEPTION 'Rollback blocked: category changed or removed after transform; inspect v2 provenance.'; END IF;

  IF EXISTS (
    SELECT 1
    FROM "CategoriaProdutoPdv" c
    JOIN "PdvCategoriaTransformacaoCategoria" ec ON ec."transformacao" = 'categoria-historica-v2'
      AND ec."cervejariaId" = c."cervejariaId" AND ec."categoriaPdvId" = c."id" AND ec."acao" = 'CRIADA'
    JOIN "Produto" p ON p."cervejariaId" = c."cervejariaId" AND p."categoriaPdvId" = c."id"
    LEFT JOIN "PdvCategoriaTransformacaoProduto" ep ON ep."transformacao" = 'categoria-historica-v2'
      AND ep."cervejariaId" = p."cervejariaId" AND ep."produtoId" = p."id"
    WHERE ep."produtoId" IS NULL
  ) THEN RAISE EXCEPTION 'Rollback blocked: a product was attached later to a category created by the transformation.'; END IF;
END $$;

UPDATE "Produto" p SET "categoria" = e."categoriaAntes", "categoriaPdvId" = e."categoriaPdvIdAntes"
FROM "PdvCategoriaTransformacaoProduto" e
WHERE e."transformacao" = 'categoria-historica-v2'
  AND p."id" = e."produtoId" AND p."cervejariaId" = e."cervejariaId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CategoriaProdutoPdv" c
    JOIN "PdvCategoriaTransformacaoCategoria" e ON e."transformacao" = 'categoria-historica-v2'
      AND e."cervejariaId" = c."cervejariaId" AND e."categoriaPdvId" = c."id" AND e."acao" = 'CRIADA'
    JOIN "Produto" p ON p."cervejariaId" = c."cervejariaId" AND p."categoriaPdvId" = c."id"
  ) THEN RAISE EXCEPTION 'Rollback blocked: a created category still has references after restore.'; END IF;
END $$;

DELETE FROM "CategoriaProdutoPdv" c USING "PdvCategoriaTransformacaoCategoria" e
WHERE e."transformacao" = 'categoria-historica-v2' AND e."acao" = 'CRIADA'
  AND c."id" = e."categoriaPdvId" AND c."cervejariaId" = e."cervejariaId";
DELETE FROM "PdvCategoriaTransformacaoProduto" WHERE "transformacao" = 'categoria-historica-v2';
DELETE FROM "PdvCategoriaTransformacaoCategoria" WHERE "transformacao" = 'categoria-historica-v2';
COMMIT;
