CREATE TYPE "public"."StatusCaixaEvento" AS ENUM ('ABERTO', 'FECHADO');
CREATE TYPE "public"."TipoMovimentoCaixaEvento" AS ENUM ('SUPRIMENTO', 'SANGRIA');
ALTER TYPE "public"."TransacaoTipo" ADD VALUE 'EVENTO_CAIXA_ABERTO';
ALTER TYPE "public"."TransacaoTipo" ADD VALUE 'EVENTO_CAIXA_MOVIMENTO';
ALTER TYPE "public"."TransacaoTipo" ADD VALUE 'EVENTO_CAIXA_FECHADO';

CREATE TABLE "public"."SessaoCaixaEvento" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "status" "public"."StatusCaixaEvento" NOT NULL DEFAULT 'ABERTO',
    "trocoInicial" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "abertoPorId" TEXT NOT NULL,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadoPorId" TEXT,
    "fechadoEm" TIMESTAMP(3),
    "contadoDinheiro" DECIMAL(10,2),
    "contadoPix" DECIMAL(10,2),
    "contadoDebito" DECIMAL(10,2),
    "contadoCredito" DECIMAL(10,2),
    "observacaoFechamento" TEXT,
    CONSTRAINT "SessaoCaixaEvento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MovimentoCaixaEvento" (
    "id" TEXT NOT NULL,
    "sessaoId" TEXT NOT NULL,
    "tipo" "public"."TipoMovimentoCaixaEvento" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "observacao" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MovimentoCaixaEvento_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."Pagamento"
ADD COLUMN "sessaoCaixaEventoId" TEXT;

CREATE INDEX "SessaoCaixaEvento_eventoId_abertoEm_idx"
ON "public"."SessaoCaixaEvento"("eventoId", "abertoEm");
CREATE INDEX "SessaoCaixaEvento_eventoId_status_idx"
ON "public"."SessaoCaixaEvento"("eventoId", "status");
CREATE UNIQUE INDEX "SessaoCaixaEvento_one_open_per_event_idx"
ON "public"."SessaoCaixaEvento"("eventoId") WHERE "status" = 'ABERTO';
CREATE INDEX "MovimentoCaixaEvento_sessaoId_createdAt_idx"
ON "public"."MovimentoCaixaEvento"("sessaoId", "createdAt");
CREATE INDEX "Pagamento_sessaoCaixaEventoId_pagoEm_idx"
ON "public"."Pagamento"("sessaoCaixaEventoId", "pagoEm");

ALTER TABLE "public"."SessaoCaixaEvento"
ADD CONSTRAINT "SessaoCaixaEvento_eventoId_fkey"
FOREIGN KEY ("eventoId") REFERENCES "public"."Evento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "SessaoCaixaEvento_abertoPorId_fkey"
FOREIGN KEY ("abertoPorId") REFERENCES "public"."Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "SessaoCaixaEvento_fechadoPorId_fkey"
FOREIGN KEY ("fechadoPorId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."MovimentoCaixaEvento"
ADD CONSTRAINT "MovimentoCaixaEvento_sessaoId_fkey"
FOREIGN KEY ("sessaoId") REFERENCES "public"."SessaoCaixaEvento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "MovimentoCaixaEvento_registradoPorId_fkey"
FOREIGN KEY ("registradoPorId") REFERENCES "public"."Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."Pagamento"
ADD CONSTRAINT "Pagamento_sessaoCaixaEventoId_fkey"
FOREIGN KEY ("sessaoCaixaEventoId") REFERENCES "public"."SessaoCaixaEvento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
