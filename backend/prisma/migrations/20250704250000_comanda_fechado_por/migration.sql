-- AlterTable
ALTER TABLE "Comanda" ADD COLUMN "fechadoPorId" TEXT;

-- CreateIndex
CREATE INDEX "Comanda_fechadoPorId_idx" ON "Comanda"("fechadoPorId");

-- AddForeignKey
ALTER TABLE "Comanda" ADD CONSTRAINT "Comanda_fechadoPorId_fkey" FOREIGN KEY ("fechadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
