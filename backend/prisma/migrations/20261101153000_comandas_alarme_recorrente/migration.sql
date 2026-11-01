-- Recurring sound alarm on open-comandas screen (Servir / payment request).
ALTER TABLE "Cervejaria" ADD COLUMN "comandasAlarmeAtivo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Cervejaria" ADD COLUMN "comandasAlarmeIntervaloSegundos" INTEGER NOT NULL DEFAULT 10;
