-- Fractional inventory quantities allow draft beer stock to be tracked in liters.
-- Existing values are converted without changing their numeric amount.
BEGIN;

ALTER TABLE "quiosque"."EstoqueSaldoQuiosque"
  ALTER COLUMN "quantidade" TYPE DECIMAL(12, 3) USING "quantidade"::DECIMAL(12, 3),
  ALTER COLUMN "estoqueMinimo" TYPE DECIMAL(12, 3) USING "estoqueMinimo"::DECIMAL(12, 3);

ALTER TABLE "quiosque"."MovimentoEstoqueQuiosque"
  ALTER COLUMN "quantidade" TYPE DECIMAL(12, 3) USING "quantidade"::DECIMAL(12, 3);

COMMIT;
