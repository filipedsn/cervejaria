ALTER TABLE "public"."Cervejaria"
ADD COLUMN "usaCardapio" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "quiosque"."ConfiguracaoQuiosque"
ADD COLUMN "usaCardapio" BOOLEAN NOT NULL DEFAULT false;
