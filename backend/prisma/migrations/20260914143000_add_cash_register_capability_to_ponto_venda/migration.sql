-- Capability at the operational-unit level. NULL retains legacy fallback.
ALTER TABLE "quiosque"."PontoVenda" ADD COLUMN "usaCaixa" BOOLEAN;
