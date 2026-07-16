-- CreateTable
CREATE TABLE "EventoSerieExclusao" (
    "id" TEXT NOT NULL,
    "serieId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoSerieExclusao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventoSerieExclusao_cervejariaId_idx" ON "EventoSerieExclusao"("cervejariaId");

-- CreateIndex
CREATE UNIQUE INDEX "EventoSerieExclusao_serieId_data_key" ON "EventoSerieExclusao"("serieId", "data");

-- AddForeignKey
ALTER TABLE "EventoSerieExclusao" ADD CONSTRAINT "EventoSerieExclusao_serieId_fkey" FOREIGN KEY ("serieId") REFERENCES "Evento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoSerieExclusao" ADD CONSTRAINT "EventoSerieExclusao_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
