ALTER TABLE "quiosque"."AgendaOperacional"
  ADD COLUMN "geracaoDesde" DATE;

-- Old series deliberately remain without a generation reference. The historical
-- first date is not a safe substitute for the user's explicit resume choice.
ALTER TABLE "quiosque"."AgendaOperacional"
  DROP CONSTRAINT IF EXISTS "AgendaOperacional_periodo_check";

ALTER TABLE "quiosque"."AgendaOperacional"
  ADD CONSTRAINT "AgendaOperacional_periodo_check"
  CHECK ("primeiraData" IS NULL OR "ultimaData" IS NULL OR "ultimaData" >= "primeiraData");
