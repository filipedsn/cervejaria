-- Desconto manual em comandas do quiosque + permissao por atendente.
ALTER TABLE "public"."Usuario"
  ADD COLUMN "podeDarDescontoQuiosque" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "quiosque"."ComandaQuiosque"
  ADD COLUMN "desconto" DECIMAL(10, 2) NOT NULL DEFAULT 0;
