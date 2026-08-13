-- Reverte 20260731162815_quiosque_modo_exclusivo.
-- Tabela do proprio modulo; nao alcanca nada da cervejaria.

ALTER TABLE "quiosque"."ConfiguracaoQuiosque" DROP COLUMN IF EXISTS "exclusivo";
