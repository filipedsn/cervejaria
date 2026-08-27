-- Rollback manual: unificar_comanda_quiosque
-- Restaura ComandaQuiosque e PagamentoQuiosque a partir de public.Comanda (origem QUIOSQUE).
-- Executar apenas se a migration 20260813200000 precisar ser revertida.

CREATE TABLE IF NOT EXISTS "quiosque"."ComandaQuiosque" (
  "id" TEXT NOT NULL,
  "cervejariaId" TEXT NOT NULL,
  "pontoVendaId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "identificador" TEXT,
  "numero" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'ABERTA',
  "diaOperacional" DATE NOT NULL,
  "abertaPorId" TEXT NOT NULL,
  "fechadaPorId" TEXT,
  "fechadaEm" TIMESTAMP(3),
  "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComandaQuiosque_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "quiosque"."PagamentoQuiosque" (
  "id" TEXT NOT NULL,
  "comandaId" TEXT NOT NULL,
  "forma" TEXT NOT NULL,
  "valor" DECIMAL(10,2) NOT NULL,
  "valorRecebido" DECIMAL(10,2),
  "troco" DECIMAL(10,2),
  "registradoPorId" TEXT NOT NULL,
  "pagoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PagamentoQuiosque_pkey" PRIMARY KEY ("id")
);

-- Dados devem ser restaurados de backup; este script só recria estrutura mínima.
