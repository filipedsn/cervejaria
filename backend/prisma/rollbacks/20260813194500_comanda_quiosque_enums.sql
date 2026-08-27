-- Rollback manual: comanda_quiosque_enums
-- Remove valores de enum adicionados para o quiosque.
-- ATENÇÃO: só é seguro se nenhuma Comanda usar MESA/FICHA/APELIDO ou origem QUIOSQUE.

DROP TYPE IF EXISTS "public"."ComandaOrigem";
