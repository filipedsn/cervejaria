-- Rollback manual: valores de enum no PostgreSQL nao podem ser removidos sem recriar o tipo.
-- Manter valores orfaos e evitar INSERT com os novos tipos apos rollback de codigo.

SELECT 1;
