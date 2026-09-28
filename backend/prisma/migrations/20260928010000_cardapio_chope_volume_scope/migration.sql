-- Keep shared event cardapios on their legacy unit-price rows while letting
-- operation cardapios explicitly include (or omit) each chope volume.
BEGIN;

ALTER TABLE "public"."Cardapio"
  ADD COLUMN "chopeVolumesConfigurados" BOOLEAN NOT NULL DEFAULT false;

UPDATE "public"."Cardapio" c
SET "chopeVolumesConfigurados" = true
WHERE EXISTS (
  SELECT 1
  FROM "public"."CardapioProduto" cp
  JOIN "public"."Produto" p ON p."id" = cp."produtoId"
  WHERE cp."cardapioId" = c."id"
    AND cp."volumeMl" = 0
    AND p."tipo" = 'BEBIDA'
    AND (p."formato" = 'CHOPE' OR (p."formato" IS NULL AND (
      lower(coalesce(p."categoria", '')) = 'chope'
      OR EXISTS (
        SELECT 1 FROM "public"."Preco" price
        WHERE price."produtoId" = p."id" AND price."volumeMl" > 1
      )
    )))
);

COMMIT;
