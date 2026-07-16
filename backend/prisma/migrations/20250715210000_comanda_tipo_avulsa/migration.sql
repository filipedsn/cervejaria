-- CreateEnum
CREATE TYPE "ComandaTipo" AS ENUM ('COMANDA', 'AVULSA');

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN "isSistema" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Comanda" ADD COLUMN "tipo" "ComandaTipo" NOT NULL DEFAULT 'COMANDA';

-- CreateIndex
CREATE INDEX "Comanda_eventoId_status_tipo_idx" ON "Comanda"("eventoId", "status", "tipo");
