-- CreateEnum
CREATE TYPE "RecorrenciaTipo" AS ENUM ('NENHUMA', 'SEMANAL');

-- AlterTable
ALTER TABLE "Evento" ADD COLUMN "horaInicio" TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE "Evento" ADD COLUMN "horaFim" TEXT;
ALTER TABLE "Evento" ADD COLUMN "recorrencia" "RecorrenciaTipo" NOT NULL DEFAULT 'NENHUMA';
ALTER TABLE "Evento" ADD COLUMN "diaSemana" INTEGER;
ALTER TABLE "Evento" ADD COLUMN "serieId" TEXT;
ALTER TABLE "Evento" ALTER COLUMN "data" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_serieId_fkey" FOREIGN KEY ("serieId") REFERENCES "Evento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "Evento_serieId_data_key" ON "Evento"("serieId", "data");

-- CreateIndex
CREATE INDEX "Evento_cervejariaId_recorrencia_idx" ON "Evento"("cervejariaId", "recorrencia");
