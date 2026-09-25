-- PostgreSQL requires the transaction that adds an enum value to commit before
-- the value can be used. Keep this data-only backfill in the next migration.
UPDATE "public"."Comanda"
SET "origem" = 'CAIXA'
WHERE "origem" = 'QUIOSQUE';
