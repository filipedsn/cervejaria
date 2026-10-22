-- Nullable by design: existing recurring rules have no trustworthy persisted bounds.
-- Do not derive these values from the visible month or from occurrence history.
ALTER TABLE "quiosque"."AgendaOperacional"
  ADD COLUMN "primeiraData" DATE,
  ADD COLUMN "ultimaData" DATE;

ALTER TABLE "quiosque"."AgendaOperacional"
  ADD CONSTRAINT "AgendaOperacional_periodo_check"
  CHECK (("primeiraData" IS NULL AND "ultimaData" IS NULL)
    OR ("primeiraData" IS NOT NULL AND "ultimaData" IS NOT NULL AND "ultimaData" >= "primeiraData"));
