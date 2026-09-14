-- Additive operational enablement materialization. Existing NULLs retain legacy fallback until backfilled.
ALTER TABLE "public"."ConfiguracaoOperacional"
  ADD COLUMN "inventoryEnabled" BOOLEAN,
  ADD COLUMN "kitchenEnabled" BOOLEAN;
