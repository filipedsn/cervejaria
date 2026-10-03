-- CreateEnum
CREATE TYPE "quiosque"."FrequenciaAgendaOperacional" AS ENUM ('SEMANAL');

-- CreateEnum
CREATE TYPE "quiosque"."StatusOcorrenciaOperacional" AS ENUM ('PROGRAMADA', 'ABERTA', 'FECHADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "quiosque"."OrigemHistoricaSessaoOperacao" AS ENUM ('CAIXA', 'EVENTO');

-- CreateEnum
CREATE TYPE "quiosque"."PdvMigrationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'BLOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "quiosque"."PdvMigrationBatchStatus" AS ENUM ('PROCESSING', 'CONFIRMED', 'BLOCKED');

-- AlterTable
ALTER TABLE "quiosque"."SessaoCaixaQuiosque" ADD COLUMN     "ocorrenciaId" TEXT,
ADD COLUMN     "origemHistorica" "quiosque"."OrigemHistoricaSessaoOperacao";

-- CreateTable
CREATE TABLE "quiosque"."AgendaOperacional" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "pontoVendaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "frequencia" "quiosque"."FrequenciaAgendaOperacional" NOT NULL DEFAULT 'SEMANAL',
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL DEFAULT '18:00',
    "horaFim" TEXT,
    "local" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."OcorrenciaOperacional" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "pontoVendaId" TEXT NOT NULL,
    "agendaId" TEXT,
    "nome" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL DEFAULT '18:00',
    "horaFim" TEXT,
    "local" TEXT,
    "status" "quiosque"."StatusOcorrenciaOperacional" NOT NULL DEFAULT 'PROGRAMADA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcorrenciaOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."PdvMigrationRun" (
    "id" TEXT NOT NULL,
    "status" "quiosque"."PdvMigrationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "transformVersion" INTEGER NOT NULL,
    "sourceSnapshotHash" TEXT NOT NULL,
    "checkpoint" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PdvMigrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."PdvMigrationBatch" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "quiosque"."PdvMigrationBatchStatus" NOT NULL DEFAULT 'PROCESSING',
    "payloadHash" TEXT NOT NULL,
    "checkpoint" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "PdvMigrationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiosque"."PdvMigrationMap" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "destinationType" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "pontoVendaId" TEXT,
    "transformVersion" INTEGER NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "lastRunId" TEXT NOT NULL,
    "lastBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdvMigrationMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgendaOperacional_pontoVendaId_ativa_idx" ON "quiosque"."AgendaOperacional"("pontoVendaId", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaOperacional_id_cervejariaId_pontoVendaId_key" ON "quiosque"."AgendaOperacional"("id", "cervejariaId", "pontoVendaId");

-- CreateIndex
CREATE INDEX "OcorrenciaOperacional_pontoVendaId_data_idx" ON "quiosque"."OcorrenciaOperacional"("pontoVendaId", "data");

-- CreateIndex
CREATE INDEX "OcorrenciaOperacional_cervejariaId_data_idx" ON "quiosque"."OcorrenciaOperacional"("cervejariaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "OcorrenciaOperacional_id_cervejariaId_pontoVendaId_key" ON "quiosque"."OcorrenciaOperacional"("id", "cervejariaId", "pontoVendaId");

-- CreateIndex
CREATE UNIQUE INDEX "OcorrenciaOperacional_agendaId_data_key" ON "quiosque"."OcorrenciaOperacional"("agendaId", "data");

-- CreateIndex
CREATE INDEX "PdvMigrationRun_status_startedAt_idx" ON "quiosque"."PdvMigrationRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "PdvMigrationBatch_runId_status_idx" ON "quiosque"."PdvMigrationBatch"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PdvMigrationBatch_runId_sequence_key" ON "quiosque"."PdvMigrationBatch"("runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PdvMigrationBatch_id_runId_key" ON "quiosque"."PdvMigrationBatch"("id", "runId");

-- CreateIndex
CREATE INDEX "PdvMigrationMap_cervejariaId_pontoVendaId_idx" ON "quiosque"."PdvMigrationMap"("cervejariaId", "pontoVendaId");

-- CreateIndex
CREATE INDEX "PdvMigrationMap_lastRunId_idx" ON "quiosque"."PdvMigrationMap"("lastRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PdvMigrationMap_sourceType_sourceId_key" ON "quiosque"."PdvMigrationMap"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PontoVenda_id_cervejariaId_key" ON "quiosque"."PontoVenda"("id", "cervejariaId");

-- CreateIndex
CREATE INDEX "SessaoCaixaQuiosque_ocorrenciaId_idx" ON "quiosque"."SessaoCaixaQuiosque"("ocorrenciaId");

-- AddForeignKey
ALTER TABLE "quiosque"."AgendaOperacional" ADD CONSTRAINT "AgendaOperacional_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."AgendaOperacional" ADD CONSTRAINT "AgendaOperacional_pontoVendaId_cervejariaId_fkey" FOREIGN KEY ("pontoVendaId", "cervejariaId") REFERENCES "quiosque"."PontoVenda"("id", "cervejariaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."OcorrenciaOperacional" ADD CONSTRAINT "OcorrenciaOperacional_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."OcorrenciaOperacional" ADD CONSTRAINT "OcorrenciaOperacional_pontoVendaId_cervejariaId_fkey" FOREIGN KEY ("pontoVendaId", "cervejariaId") REFERENCES "quiosque"."PontoVenda"("id", "cervejariaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."OcorrenciaOperacional" ADD CONSTRAINT "OcorrenciaOperacional_agendaId_cervejariaId_pontoVendaId_fkey" FOREIGN KEY ("agendaId", "cervejariaId", "pontoVendaId") REFERENCES "quiosque"."AgendaOperacional"("id", "cervejariaId", "pontoVendaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PdvMigrationBatch" ADD CONSTRAINT "PdvMigrationBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "quiosque"."PdvMigrationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PdvMigrationMap" ADD CONSTRAINT "PdvMigrationMap_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PdvMigrationMap" ADD CONSTRAINT "PdvMigrationMap_pontoVendaId_cervejariaId_fkey" FOREIGN KEY ("pontoVendaId", "cervejariaId") REFERENCES "quiosque"."PontoVenda"("id", "cervejariaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PdvMigrationMap" ADD CONSTRAINT "PdvMigrationMap_lastRunId_fkey" FOREIGN KEY ("lastRunId") REFERENCES "quiosque"."PdvMigrationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."PdvMigrationMap" ADD CONSTRAINT "PdvMigrationMap_lastBatchId_lastRunId_fkey" FOREIGN KEY ("lastBatchId", "lastRunId") REFERENCES "quiosque"."PdvMigrationBatch"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiosque"."SessaoCaixaQuiosque" ADD CONSTRAINT "SessaoCaixaQuiosque_ocorrenciaId_cervejariaId_pontoVendaId_fkey" FOREIGN KEY ("ocorrenciaId", "cervejariaId", "pontoVendaId") REFERENCES "quiosque"."OcorrenciaOperacional"("id", "cervejariaId", "pontoVendaId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Weekly recurrence uses PostgreSQL day numbering 0 through 6.
ALTER TABLE "quiosque"."AgendaOperacional"
  ADD CONSTRAINT "AgendaOperacional_diaSemana_check" CHECK ("diaSemana" BETWEEN 0 AND 6);
