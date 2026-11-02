-- Contract start date and monthly due day managed by the platform admin.
ALTER TABLE "Cervejaria" ADD COLUMN "dataInicioContrato" DATE;
ALTER TABLE "Cervejaria" ADD COLUMN "diaVencimento" INTEGER;
ALTER TABLE "Cervejaria" ADD CONSTRAINT "Cervejaria_diaVencimento_check" CHECK ("diaVencimento" BETWEEN 1 AND 31);
