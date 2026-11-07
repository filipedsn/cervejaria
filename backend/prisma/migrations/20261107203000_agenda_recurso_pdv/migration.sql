-- TAP-182: Agenda operacional como recurso opcional do PDV.
-- Default true preserva o comportamento atual; o dono desliga em Recursos do PDV.
ALTER TABLE "public"."ConfiguracaoOperacional"
ADD COLUMN "agendaEnabled" BOOLEAN;

ALTER TABLE "quiosque"."ConfiguracaoPontoVenda"
ADD COLUMN "agendaEnabled" BOOLEAN NOT NULL DEFAULT true;
