-- Desconto manual em comandas do modo cervejaria (evento).
ALTER TABLE "public"."Comanda"
  ADD COLUMN "desconto" DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TYPE "public"."TransacaoTipo" ADD VALUE IF NOT EXISTS 'COMANDA_DESCONTO_APLICADO';
