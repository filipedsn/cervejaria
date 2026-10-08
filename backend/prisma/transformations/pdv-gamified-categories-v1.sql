-- Executar somente em QA descartável depois da migration aditiva.
-- Atomic, reentrant e preserva IDs/textos históricos de Produto.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Produto" WHERE length("categoria") > 80) THEN
    RAISE EXCEPTION 'Categoria histórica excede 80 caracteres; nenhum vínculo foi alterado.';
  END IF;
  IF EXISTS (
    WITH source_names AS (
      SELECT "cervejariaId", "nome" AS raw_name FROM "CategoriaProdutoPdv"
      UNION ALL
      SELECT "cervejariaId", "categoria" FROM "Produto" WHERE "categoria" IS NOT NULL AND "categoriaPdvId" IS NULL
    ), normalized AS (
      SELECT "cervejariaId", raw_name,
        lower(regexp_replace(trim(translate(raw_name,
          'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
          '\s+', ' ', 'g')) AS normalized_name
      FROM source_names
    )
    SELECT 1 FROM normalized
    GROUP BY "cervejariaId", normalized_name
    HAVING count(DISTINCT raw_name) > 1
  ) THEN
    RAISE EXCEPTION 'Categoria histórica colide após normalização; nenhum vínculo foi alterado. Revise nomes e autorize eventual fusão separadamente.';
  END IF;
END $$;

WITH source_names AS (
  SELECT DISTINCT "cervejariaId", "categoria" AS raw_name
  FROM "Produto"
  WHERE "categoria" IS NOT NULL AND trim("categoria") <> '' AND "categoriaPdvId" IS NULL
), normalized AS (
  SELECT "cervejariaId", raw_name,
    lower(regexp_replace(trim(translate(raw_name,
      'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
      '\s+', ' ', 'g')) AS normalized_name
  FROM source_names
)
INSERT INTO "CategoriaProdutoPdv" ("id", "cervejariaId", "nome", "nomeNormalizado", "gamificada", "origemMigracao", "createdAt", "updatedAt")
SELECT 'cat_' || md5("cervejariaId" || ':' || normalized_name), "cervejariaId", raw_name, normalized_name, false,
       'categoria-historica-v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM normalized
ON CONFLICT ("cervejariaId", "nomeNormalizado") DO NOTHING;

UPDATE "Produto" p
SET "categoriaPdvId" = c."id"
FROM "CategoriaProdutoPdv" c
WHERE p."categoriaPdvId" IS NULL
  AND p."categoria" IS NOT NULL
  AND p."cervejariaId" = c."cervejariaId"
  AND c."nomeNormalizado" = lower(regexp_replace(trim(translate(trim(regexp_replace(p."categoria", '\s+', ' ', 'g')),
    'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
    '\s+', ' ', 'g'));

COMMIT;
