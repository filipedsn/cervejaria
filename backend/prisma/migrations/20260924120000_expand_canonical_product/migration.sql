-- Expand phase of the operational-domain convergence.  Historical tables are
-- deliberately retained until every consumer has cut over and reconciliation passes.
ALTER TABLE "public"."Produto"
  ADD COLUMN IF NOT EXISTS "categoria" TEXT,
  ADD COLUMN IF NOT EXISTS "controlaEstoque" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "exigePreparo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ordem" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "public"."ProdutoMigracaoMapa" (
  "legacyProdutoId" TEXT PRIMARY KEY,
  "canonicalProdutoId" TEXT NOT NULL UNIQUE,
  "source" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "migrationRun" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Reusing the legacy CUID is deterministic and preserves every existing FK.
-- A pre-existing canonical id without a prior mapping is ambiguous, so fail
-- atomically rather than silently joining products by name or price.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "quiosque"."ProdutoQuiosque" legacy
    JOIN "public"."Produto" canonical ON canonical."id" = legacy."id"
    LEFT JOIN "public"."ProdutoMigracaoMapa" mapa ON mapa."legacyProdutoId" = legacy."id"
    WHERE mapa."canonicalProdutoId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Produto legacy id collides with an unmapped canonical product';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "public"."ItemComanda"
    WHERE "produtoId" IS NOT NULL
      AND "produtoQuiosqueId" IS NOT NULL
      AND "produtoId" <> "produtoQuiosqueId"
  ) THEN
    RAISE EXCEPTION 'ItemComanda has conflicting canonical and legacy product references';
  END IF;
END $$;

INSERT INTO "public"."Produto" (
  "id", "nome", "categoria", "tipo", "formato", "controlaEstoque",
  "exigePreparo", "ordem", "ativo", "cervejariaId", "createdAt", "updatedAt"
)
SELECT
  legacy."id",
  legacy."nome",
  legacy."categoria",
  CASE WHEN lower(coalesce(legacy."categoria", '')) LIKE '%comida%' THEN 'COMIDA'::"public"."ProdutoTipo" ELSE 'BEBIDA'::"public"."ProdutoTipo" END,
  CASE WHEN lower(coalesce(legacy."categoria", '')) LIKE '%comida%' THEN NULL ELSE 'OUTRO'::"public"."FormatoBebida" END,
  legacy."controlaEstoque",
  legacy."exigePreparo",
  legacy."ordem",
  legacy."ativo",
  legacy."cervejariaId",
  legacy."createdAt",
  legacy."updatedAt"
FROM "quiosque"."ProdutoQuiosque" legacy
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "public"."Preco" ("id", "produtoId", "volumeMl", "preco")
SELECT md5('canonical-unit-price:' || legacy."id"), legacy."id", 1, legacy."precoUnit"
FROM "quiosque"."ProdutoQuiosque" legacy
ON CONFLICT ("produtoId", "volumeMl") DO NOTHING;

INSERT INTO "public"."ProdutoMigracaoMapa" (
  "legacyProdutoId", "canonicalProdutoId", "source", "reason", "migrationRun"
)
SELECT legacy."id", legacy."id", 'ProdutoQuiosque', 'preserved-id-no-heuristic-deduplication', '20260924120000_expand_canonical_product'
FROM "quiosque"."ProdutoQuiosque" legacy
ON CONFLICT ("legacyProdutoId") DO NOTHING;

UPDATE "public"."ItemComanda"
SET "produtoId" = "produtoQuiosqueId"
WHERE "produtoId" IS NULL AND "produtoQuiosqueId" IS NOT NULL;
