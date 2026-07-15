-- AlterTable
ALTER TABLE "Comanda" ADD COLUMN "fechadaEm" TIMESTAMP(3);

-- Backfill: comandas já fechadas usam updatedAt como proxy do fechamento
UPDATE "Comanda" SET "fechadaEm" = "updatedAt" WHERE "status" = 'FECHADA' AND "fechadaEm" IS NULL;
