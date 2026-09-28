ALTER TABLE "public"."ConfiguracaoOperacional"
ADD COLUMN "setupCompletedAt" TIMESTAMP(3);

UPDATE "public"."ConfiguracaoOperacional"
SET "setupCompletedAt" = CURRENT_TIMESTAMP;
