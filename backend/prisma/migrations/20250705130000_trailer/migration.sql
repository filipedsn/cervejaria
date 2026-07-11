-- CreateTable
CREATE TABLE "Trailer" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "identificador" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "cervejariaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trailer_pkey" PRIMARY KEY ("id")
);

-- Default trailer per brewery
INSERT INTO "Trailer" ("id", "nome", "ativo", "cervejariaId", "createdAt", "updatedAt")
SELECT
    'trailer_' || "id",
    'Principal',
    true,
    "id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Cervejaria";

-- Add trailerId columns
ALTER TABLE "Tap" ADD COLUMN "trailerId" TEXT;
ALTER TABLE "Evento" ADD COLUMN "trailerId" TEXT;

-- Backfill from default trailer
UPDATE "Tap" SET "trailerId" = 'trailer_' || "cervejariaId";
UPDATE "Evento" SET "trailerId" = 'trailer_' || "cervejariaId";

-- Enforce NOT NULL
ALTER TABLE "Tap" ALTER COLUMN "trailerId" SET NOT NULL;
ALTER TABLE "Evento" ALTER COLUMN "trailerId" SET NOT NULL;

-- Replace Tap unique constraint
DROP INDEX "Tap_cervejariaId_numero_key";
CREATE UNIQUE INDEX "Tap_trailerId_numero_key" ON "Tap"("trailerId", "numero");

-- Indexes
CREATE INDEX "Trailer_cervejariaId_idx" ON "Trailer"("cervejariaId");
CREATE INDEX "Tap_trailerId_idx" ON "Tap"("trailerId");
CREATE INDEX "Evento_trailerId_idx" ON "Evento"("trailerId");

-- Foreign keys
ALTER TABLE "Trailer" ADD CONSTRAINT "Trailer_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tap" ADD CONSTRAINT "Tap_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
