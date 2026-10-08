-- QA-only, atomic and replayable historical category transformation.
-- Migration-control key v2 carries provenance; this is data evidence, not a migration framework.
BEGIN;
LOCK TABLE "Produto", "CategoriaProdutoPdv", "PdvCategoriaTransformacaoProduto", "PdvCategoriaTransformacaoCategoria" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_key CONSTANT text := 'categoria-historica-v2';
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PdvCategoriaTransformacaoProduto" e
    LEFT JOIN "Produto" p ON p."id" = e."produtoId" AND p."cervejariaId" = e."cervejariaId"
    WHERE e."transformacao" = v_key
      AND (p."id" IS NULL OR p."categoria" IS DISTINCT FROM e."categoriaDepois"
        OR p."categoriaPdvId" IS DISTINCT FROM e."categoriaPdvIdDepois")
  ) THEN
    RAISE EXCEPTION 'Transformation blocked: product text or link differs from v2 provenance.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "PdvCategoriaTransformacaoCategoria" e
    LEFT JOIN "CategoriaProdutoPdv" c ON c."id" = e."categoriaPdvId" AND c."cervejariaId" = e."cervejariaId"
    WHERE e."transformacao" = v_key
      AND (c."id" IS NULL OR c."nome" IS DISTINCT FROM e."nome"
        OR c."nomeNormalizado" IS DISTINCT FROM e."nomeNormalizado"
        OR c."gamificada" IS DISTINCT FROM e."gamificada"
        OR c."origemMigracao" IS DISTINCT FROM e."origemMigracao")
  ) THEN
    RAISE EXCEPTION 'Transformation blocked: category changed or removed after v2 provenance snapshot.';
  END IF;
  IF EXISTS (SELECT 1 FROM "Produto" WHERE "categoriaPdvId" IS NULL AND length("categoria") > 80) THEN
    RAISE EXCEPTION 'Transformation blocked: historical category exceeds 80 characters.';
  END IF;
  IF EXISTS (
    WITH source_names AS (
      SELECT "cervejariaId", "nome" AS raw_name FROM "CategoriaProdutoPdv"
      UNION ALL
      SELECT "cervejariaId", "categoria" FROM "Produto"
      WHERE "categoriaPdvId" IS NULL AND "categoria" IS NOT NULL AND trim("categoria") <> ''
    ), normalized AS (
      SELECT "cervejariaId", raw_name,
        lower(regexp_replace(trim(translate(raw_name,
          U&'\00e1\00e0\00e3\00e2\00e4\00e9\00e8\00ea\00eb\00ed\00ec\00ee\00ef\00f3\00f2\00f5\00f4\00f6\00fa\00f9\00fb\00fc\00e7\00c1\00c0\00c3\00c2\00c4\00c9\00c8\00ca\00cb\00cd\00cc\00ce\00cf\00d3\00d2\00d5\00d4\00d6\00da\00d9\00db\00dc\00c7',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
          '\s+', ' ', 'g')) AS normalized_name
      FROM source_names
    )
    SELECT 1 FROM normalized GROUP BY "cervejariaId", normalized_name
    HAVING count(DISTINCT raw_name) > 1
  ) THEN
    RAISE EXCEPTION 'Transformation blocked: category names collide after normalization; no merge performed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CategoriaProdutoPdv" c
    JOIN "PdvCategoriaTransformacaoCategoria" ec ON ec."transformacao" = v_key
      AND ec."cervejariaId" = c."cervejariaId" AND ec."categoriaPdvId" = c."id" AND ec."acao" = 'CRIADA'
    JOIN "Produto" p ON p."cervejariaId" = c."cervejariaId" AND p."categoriaPdvId" = c."id"
    LEFT JOIN "PdvCategoriaTransformacaoProduto" ep ON ep."transformacao" = v_key
      AND ep."cervejariaId" = p."cervejariaId" AND ep."produtoId" = p."id"
    WHERE ep."produtoId" IS NULL
  ) THEN RAISE EXCEPTION 'Replay blocked: a new product was attached after category transformation.'; END IF;
END $$;

WITH source_names AS (
  SELECT DISTINCT "cervejariaId", "categoria" AS raw_name
  FROM "Produto"
  WHERE "categoriaPdvId" IS NULL AND "categoria" IS NOT NULL AND trim("categoria") <> ''
), normalized AS (
  SELECT "cervejariaId", raw_name,
    lower(regexp_replace(trim(translate(raw_name,
      U&'\00e1\00e0\00e3\00e2\00e4\00e9\00e8\00ea\00eb\00ed\00ec\00ee\00ef\00f3\00f2\00f5\00f4\00f6\00fa\00f9\00fb\00fc\00e7\00c1\00c0\00c3\00c2\00c4\00c9\00c8\00ca\00cb\00cd\00cc\00ce\00cf\00d3\00d2\00d5\00d4\00d6\00da\00d9\00db\00dc\00c7',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
      '\s+', ' ', 'g')) AS normalized_name
  FROM source_names
)
INSERT INTO "CategoriaProdutoPdv" ("id", "cervejariaId", "nome", "nomeNormalizado", "gamificada", "origemMigracao", "createdAt", "updatedAt")
SELECT 'cat_' || md5(n."cervejariaId" || ':' || n.normalized_name), n."cervejariaId", n.raw_name, n.normalized_name,
       false, 'categoria-historica-v2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM normalized n
ON CONFLICT ("cervejariaId", "nomeNormalizado") DO NOTHING;

INSERT INTO "PdvCategoriaTransformacaoCategoria"
  ("transformacao", "cervejariaId", "categoriaPdvId", "acao", "nome", "nomeNormalizado", "gamificada", "origemMigracao")
SELECT 'categoria-historica-v2', c."cervejariaId", c."id",
       CASE WHEN c."origemMigracao" = 'categoria-historica-v2' THEN 'CRIADA' ELSE 'REAPROVEITADA' END,
       c."nome", c."nomeNormalizado", c."gamificada", c."origemMigracao"
FROM "CategoriaProdutoPdv" c
WHERE c."origemMigracao" = 'categoria-historica-v2'
   OR EXISTS (
     SELECT 1 FROM "Produto" p WHERE p."cervejariaId" = c."cervejariaId"
       AND p."categoriaPdvId" IS NULL AND p."categoria" IS NOT NULL
       AND lower(regexp_replace(trim(translate(trim(regexp_replace(p."categoria", '\s+', ' ', 'g')),
         U&'\00e1\00e0\00e3\00e2\00e4\00e9\00e8\00ea\00eb\00ed\00ec\00ee\00ef\00f3\00f2\00f5\00f4\00f6\00fa\00f9\00fb\00fc\00e7\00c1\00c0\00c3\00c2\00c4\00c9\00c8\00ca\00cb\00cd\00cc\00ce\00cf\00d3\00d2\00d5\00d4\00d6\00da\00d9\00db\00dc\00c7',
         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
         '\s+', ' ', 'g')) = c."nomeNormalizado"
   )
ON CONFLICT ("transformacao", "cervejariaId", "categoriaPdvId") DO NOTHING;

INSERT INTO "PdvCategoriaTransformacaoProduto"
  ("transformacao", "cervejariaId", "produtoId", "categoriaAntes", "categoriaPdvIdAntes", "categoriaDepois", "categoriaPdvIdDepois")
SELECT 'categoria-historica-v2', p."cervejariaId", p."id", p."categoria", p."categoriaPdvId", p."categoria",
       c."id"
FROM "Produto" p
JOIN "CategoriaProdutoPdv" c ON c."cervejariaId" = p."cervejariaId"
  AND c."nomeNormalizado" = lower(regexp_replace(trim(translate(trim(regexp_replace(p."categoria", '\s+', ' ', 'g')),
    U&'\00e1\00e0\00e3\00e2\00e4\00e9\00e8\00ea\00eb\00ed\00ec\00ee\00ef\00f3\00f2\00f5\00f4\00f6\00fa\00f9\00fb\00fc\00e7\00c1\00c0\00c3\00c2\00c4\00c9\00c8\00ca\00cb\00cd\00cc\00ce\00cf\00d3\00d2\00d5\00d4\00d6\00da\00d9\00db\00dc\00c7',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
    '\s+', ' ', 'g'))
WHERE p."categoriaPdvId" IS NULL AND p."categoria" IS NOT NULL AND trim(p."categoria") <> ''
ON CONFLICT ("transformacao", "cervejariaId", "produtoId") DO NOTHING;

UPDATE "Produto" p SET "categoriaPdvId" = e."categoriaPdvIdDepois"
FROM "PdvCategoriaTransformacaoProduto" e
WHERE e."transformacao" = 'categoria-historica-v2'
  AND p."id" = e."produtoId" AND p."cervejariaId" = e."cervejariaId"
  AND p."categoriaPdvId" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PdvCategoriaTransformacaoProduto" e
    LEFT JOIN "Produto" p ON p."id" = e."produtoId" AND p."cervejariaId" = e."cervejariaId"
    WHERE e."transformacao" = 'categoria-historica-v2'
      AND (p."id" IS NULL OR p."categoria" IS DISTINCT FROM e."categoriaDepois"
        OR p."categoriaPdvId" IS DISTINCT FROM e."categoriaPdvIdDepois")
  ) THEN RAISE EXCEPTION 'Transforma??o incompleta: estado final n?o confere com a proveni?ncia.'; END IF;
END $$;
COMMIT;
