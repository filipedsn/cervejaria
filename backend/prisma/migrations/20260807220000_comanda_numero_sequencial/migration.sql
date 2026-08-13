ALTER TABLE "public"."Comanda"
ADD COLUMN "numero" INTEGER;

ALTER TABLE "quiosque"."ComandaQuiosque"
ADD COLUMN "numero" INTEGER;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "eventoId" ORDER BY "createdAt") AS rn
  FROM "public"."Comanda"
  WHERE "tipo" = 'COMANDA'
)
UPDATE "public"."Comanda" c
SET "numero" = r.rn
FROM ranked r
WHERE c.id = r.id;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "pontoVendaId", "diaOperacional" ORDER BY "createdAt") AS rn
  FROM "quiosque"."ComandaQuiosque"
  WHERE "tipo" <> 'AVULSA'
)
UPDATE "quiosque"."ComandaQuiosque" c
SET "numero" = r.rn
FROM ranked r
WHERE c.id = r.id;
