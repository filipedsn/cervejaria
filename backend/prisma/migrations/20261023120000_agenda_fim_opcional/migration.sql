ALTER TABLE "quiosque"."AgendaOperacional"
  DROP CONSTRAINT IF EXISTS "AgendaOperacional_periodo_check";

ALTER TABLE "quiosque"."AgendaOperacional"
  ADD CONSTRAINT "AgendaOperacional_periodo_check"
  CHECK (
    ("primeiraData" IS NULL AND "ultimaData" IS NULL)
    OR ("primeiraData" IS NOT NULL AND ("ultimaData" IS NULL OR "ultimaData" >= "primeiraData"))
  );
