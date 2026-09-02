-- Alerta opcional por produto e ponto de venda. NULL preserva o comportamento
-- dos clientes existentes: sem aviso de estoque baixo configurado.
ALTER TABLE "quiosque"."EstoqueSaldoQuiosque"
  ADD COLUMN "estoqueMinimo" INTEGER;

ALTER TABLE "quiosque"."EstoqueSaldoQuiosque"
  ADD CONSTRAINT "EstoqueSaldoQuiosque_estoqueMinimo_nonnegative"
  CHECK ("estoqueMinimo" IS NULL OR "estoqueMinimo" >= 0);
