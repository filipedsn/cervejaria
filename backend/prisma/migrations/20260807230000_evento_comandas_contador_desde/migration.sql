ALTER TABLE "public"."Evento"
ADD COLUMN "comandasContadorDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "public"."Evento"
SET "comandasContadorDesde" = "createdAt";
