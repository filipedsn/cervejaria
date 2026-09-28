-- Allow each chope serving size to be a separate saved-menu and shift item.
-- Existing rows remain volumeMl = 0 and continue to represent unit products.
BEGIN;

ALTER TABLE "public"."CardapioProduto"
  ADD COLUMN "volumeMl" INTEGER NOT NULL DEFAULT 0;


DROP INDEX "public"."CardapioProduto_cardapioId_produtoId_key";
CREATE UNIQUE INDEX "CardapioProduto_cardapioId_produtoId_volumeMl_key"
  ON "public"."CardapioProduto"("cardapioId", "produtoId", "volumeMl");

-- Backfill chope variants without changing the legacy volume-0 row. The latter
-- remains available to event-mode readers that still use one price per product.
INSERT INTO "public"."CardapioProduto" ("id", "cardapioId", "produtoId", "volumeMl", "precoUnit")
SELECT md5(random()::text || clock_timestamp()::text), cp."cardapioId", cp."produtoId", price."volumeMl", price."preco"
FROM "public"."CardapioProduto" cp
JOIN "public"."Produto" p ON p."id" = cp."produtoId"
JOIN "public"."Preco" price ON price."produtoId" = p."id" AND price."volumeMl" > 1
WHERE cp."volumeMl" = 0
  AND p."tipo" = 'BEBIDA'
  AND (p."formato" = 'CHOPE' OR (p."formato" IS NULL AND (lower(coalesce(p."categoria", '')) = 'chope' OR EXISTS (
    SELECT 1 FROM "public"."Preco" other_price
    WHERE other_price."produtoId" = p."id" AND other_price."volumeMl" > 1
  ))))
ON CONFLICT ("cardapioId", "produtoId", "volumeMl") DO NOTHING;


ALTER TABLE "quiosque"."SessaoCaixaProdutoQuiosque"
  ADD COLUMN "volumeMl" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "quiosque"."SessaoCaixaProdutoQuiosque_sessaoCaixaId_produtoId_key";
CREATE UNIQUE INDEX "SessaoCaixaProdutoQuiosque_sessaoCaixaId_produtoId_volumeMl_key"
  ON "quiosque"."SessaoCaixaProdutoQuiosque"("sessaoCaixaId", "produtoId", "volumeMl");

INSERT INTO "quiosque"."SessaoCaixaProdutoQuiosque" ("id", "sessaoCaixaId", "produtoId", "volumeMl", "precoUnit", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text), item."sessaoCaixaId", item."produtoId", price."volumeMl", NULL, item."createdAt"
FROM "quiosque"."SessaoCaixaProdutoQuiosque" item
JOIN "public"."Produto" p ON p."id" = item."produtoId"
JOIN "public"."Preco" price ON price."produtoId" = p."id" AND price."volumeMl" > 1
WHERE item."volumeMl" = 0
  AND p."tipo" = 'BEBIDA'
  AND (p."formato" = 'CHOPE' OR (p."formato" IS NULL AND (lower(coalesce(p."categoria", '')) = 'chope' OR EXISTS (
    SELECT 1 FROM "public"."Preco" other_price
    WHERE other_price."produtoId" = p."id" AND other_price."volumeMl" > 1
  ))))
ON CONFLICT ("sessaoCaixaId", "produtoId", "volumeMl") DO NOTHING;

COMMIT;
