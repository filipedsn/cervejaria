-- AlterTable
ALTER TABLE "Evento" ADD COLUMN "encerradoEm" TIMESTAMP(3);

-- Eventos já encerrados: usa updatedAt como referência (janela de reabertura provavelmente expirada)
UPDATE "Evento" SET "encerradoEm" = "updatedAt" WHERE "status" = 'FECHADO';
