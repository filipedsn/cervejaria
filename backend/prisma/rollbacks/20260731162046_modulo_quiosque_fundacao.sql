-- Reverte 20260731162046_modulo_quiosque_fundacao.
-- Remove o schema inteiro do modulo Quiosque. Nada fora do modulo referencia
-- estas tabelas, entao o CASCADE nao alcanca dados da cervejaria.

DROP SCHEMA IF EXISTS "quiosque" CASCADE;
