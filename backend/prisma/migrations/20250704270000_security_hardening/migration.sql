-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Partial unique index: at most one ABERTO event per cervejaria (prevents race on assertNoOpenEvent)
CREATE UNIQUE INDEX "Evento_cervejaria_aberto_unique" ON "Evento"("cervejariaId") WHERE "status" = 'ABERTO';
