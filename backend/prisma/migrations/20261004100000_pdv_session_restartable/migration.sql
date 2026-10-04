-- AlterTable
ALTER TABLE "quiosque"."PdvMigrationRun" ADD COLUMN     "cervejariaId" TEXT,
ADD COLUMN     "pontoVendaId" TEXT,
ADD COLUMN     "scope" TEXT;

-- AlterTable
ALTER TABLE "quiosque"."SessaoCaixaQuiosque" ADD COLUMN     "contadoCartao" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "PdvMigrationRun_scope_cervejariaId_pontoVendaId_idx" ON "quiosque"."PdvMigrationRun"("scope", "cervejariaId", "pontoVendaId");

-- AddForeignKey
ALTER TABLE "quiosque"."PdvMigrationRun" ADD CONSTRAINT "PdvMigrationRun_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
