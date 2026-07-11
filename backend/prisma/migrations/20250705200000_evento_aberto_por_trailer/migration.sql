-- Permite vários eventos ABERTOS na mesma cervejaria (trailers diferentes).
-- Invariante operacional: no máximo 1 evento ABERTO por trailer.

DROP INDEX IF EXISTS "Evento_cervejaria_aberto_unique";

CREATE UNIQUE INDEX "Evento_trailer_aberto_unique"
  ON "Evento"("trailerId")
  WHERE "status" = 'ABERTO' AND "data" IS NOT NULL;
