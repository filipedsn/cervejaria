-- CreateEnum
CREATE TYPE "CadastroOrigem" AS ENUM ('STAFF', 'AUTO_ATENDIMENTO', 'COMANDA');

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN "email" TEXT,
ADD COLUMN "dataNascimento" TIMESTAMP(3),
ADD COLUMN "optInMarketing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "optInEm" TIMESTAMP(3),
ADD COLUMN "cadastradoVia" "CadastroOrigem" NOT NULL DEFAULT 'COMANDA',
ADD COLUMN "observacoes" TEXT,
ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ClienteEstatisticas" (
    "clienteId" TEXT NOT NULL,
    "totalComandasFechadas" INTEGER NOT NULL DEFAULT 0,
    "totalGasto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalMlChope" INTEGER NOT NULL DEFAULT 0,
    "primeiraVisitaEm" TIMESTAMP(3),
    "ultimaVisitaEm" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClienteEstatisticas_pkey" PRIMARY KEY ("clienteId")
);

-- CreateIndex
CREATE INDEX "Cliente_cervejariaId_ativo_idx" ON "Cliente"("cervejariaId", "ativo");

-- AddForeignKey
ALTER TABLE "ClienteEstatisticas" ADD CONSTRAINT "ClienteEstatisticas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
