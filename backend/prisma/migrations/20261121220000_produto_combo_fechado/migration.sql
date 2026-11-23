-- Combo fechado (itens fixos, sem escolha na venda).
ALTER TABLE "public"."Produto"
ADD COLUMN "comboFechado" BOOLEAN NOT NULL DEFAULT false;
