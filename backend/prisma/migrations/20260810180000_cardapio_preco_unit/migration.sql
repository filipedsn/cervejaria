-- Preco por item nos templates de cardapio (cervejaria + quiosque)
ALTER TABLE "CardapioProduto" ADD COLUMN "precoUnit" DECIMAL(10,2);

UPDATE "CardapioProduto" cp
SET "precoUnit" = (
  SELECT pp."preco"
  FROM "Preco" pp
  WHERE pp."produtoId" = cp."produtoId"
  ORDER BY pp."volumeMl" ASC
  LIMIT 1
)
WHERE "precoUnit" IS NULL;

ALTER TABLE "CardapioProduto" ALTER COLUMN "precoUnit" SET NOT NULL;

ALTER TABLE "quiosque"."CardapioQuiosqueProduto" ADD COLUMN "precoUnit" DECIMAL(10,2);

UPDATE "quiosque"."CardapioQuiosqueProduto" cp
SET "precoUnit" = pq."precoUnit"
FROM "quiosque"."ProdutoQuiosque" pq
WHERE pq."id" = cp."produtoQuiosqueId"
  AND cp."precoUnit" IS NULL;

ALTER TABLE "quiosque"."CardapioQuiosqueProduto" ALTER COLUMN "precoUnit" SET NOT NULL;
