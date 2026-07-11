-- CreateTable
CREATE TABLE "TapMontagem" (
    "id" TEXT NOT NULL,
    "tapId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradoEm" TIMESTAMP(3),

    CONSTRAINT "TapMontagem_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ItemComanda" ADD COLUMN "tapId" TEXT;

-- CreateIndex
CREATE INDEX "TapMontagem_eventoId_encerradoEm_idx" ON "TapMontagem"("eventoId", "encerradoEm");
CREATE INDEX "TapMontagem_tapId_eventoId_idx" ON "TapMontagem"("tapId", "eventoId");
CREATE UNIQUE INDEX "TapMontagem_tap_evento_ativo_key" ON "TapMontagem"("tapId", "eventoId") WHERE "encerradoEm" IS NULL;
CREATE INDEX "ItemComanda_tapId_idx" ON "ItemComanda"("tapId");

-- AddForeignKey
ALTER TABLE "TapMontagem" ADD CONSTRAINT "TapMontagem_tapId_fkey" FOREIGN KEY ("tapId") REFERENCES "Tap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TapMontagem" ADD CONSTRAINT "TapMontagem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TapMontagem" ADD CONSTRAINT "TapMontagem_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "Evento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemComanda" ADD CONSTRAINT "ItemComanda_tapId_fkey" FOREIGN KEY ("tapId") REFERENCES "Tap"("id") ON DELETE SET NULL ON UPDATE CASCADE;
