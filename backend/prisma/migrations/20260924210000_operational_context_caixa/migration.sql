-- The operational context is now CAIXA. QUIOSQUE remains in the enum only as
-- a physical compatibility value for historical rows and is never selected by
-- new runtime flows.
ALTER TYPE "public"."ComandaOrigem" ADD VALUE IF NOT EXISTS 'CAIXA';

UPDATE "public"."Comanda"
SET "origem" = 'CAIXA'
WHERE "origem" = 'QUIOSQUE';
