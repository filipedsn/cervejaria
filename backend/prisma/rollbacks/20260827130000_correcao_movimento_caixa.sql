ALTER TABLE "quiosque"."MovimentoCaixaQuiosque"
  DROP CONSTRAINT IF EXISTS "MovimentoCaixaQuiosque_correcaoDeId_fkey";
DROP INDEX IF EXISTS "quiosque"."MovimentoCaixaQuiosque_correcaoDeId_idx";
ALTER TABLE "quiosque"."MovimentoCaixaQuiosque"
  DROP COLUMN IF EXISTS "corrigidoEm",
  DROP COLUMN IF EXISTS "solicitadoPorId",
  DROP COLUMN IF EXISTS "autorizadoPorId",
  DROP COLUMN IF EXISTS "motivoCorrecao",
  DROP COLUMN IF EXISTS "naturezaCorrecao",
  DROP COLUMN IF EXISTS "correcaoDeId";
DROP TYPE IF EXISTS "quiosque"."NaturezaCorrecaoMovimentoCaixaQuiosque";
-- PostgreSQL nao permite remover valor de enum TransacaoTipo de forma segura.
