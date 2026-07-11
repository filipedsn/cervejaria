-- CreateEnum
CREATE TYPE "TransacaoTipo" AS ENUM (
  'COMANDA_CRIADA',
  'COMANDA_ITEM_ADICIONADO',
  'COMANDA_ITEM_REMOVIDO',
  'COMANDA_FECHADA',
  'COMANDA_CANCELADA',
  'EVENTO_CRIADO',
  'EVENTO_SESSAO_INICIADA',
  'EVENTO_ATUALIZADO',
  'EVENTO_FECHADO',
  'EVENTO_REABERTO',
  'EVENTO_EXCLUIDO',
  'EVENTO_CARDAPIO_ATUALIZADO',
  'TAP_CHOPE_POSICIONADO',
  'TAP_CHOPE_REMOVIDO',
  'TAP_ATIVO_ALTERADO'
);

-- CreateTable
CREATE TABLE "TransacaoLog" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "tipo" "TransacaoTipo" NOT NULL,
    "usuarioId" TEXT,
    "eventoId" TEXT,
    "comandaId" TEXT,
    "entidadeTipo" TEXT,
    "entidadeId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransacaoLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransacaoLog_cervejariaId_createdAt_idx" ON "TransacaoLog"("cervejariaId", "createdAt");

-- CreateIndex
CREATE INDEX "TransacaoLog_eventoId_createdAt_idx" ON "TransacaoLog"("eventoId", "createdAt");

-- CreateIndex
CREATE INDEX "TransacaoLog_comandaId_createdAt_idx" ON "TransacaoLog"("comandaId", "createdAt");

-- CreateIndex
CREATE INDEX "TransacaoLog_tipo_idx" ON "TransacaoLog"("tipo");

-- AddForeignKey
ALTER TABLE "TransacaoLog" ADD CONSTRAINT "TransacaoLog_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransacaoLog" ADD CONSTRAINT "TransacaoLog_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransacaoLog" ADD CONSTRAINT "TransacaoLog_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "Evento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransacaoLog" ADD CONSTRAINT "TransacaoLog_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "Comanda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
