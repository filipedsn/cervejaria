-- Preço opcional só do turno (null = herda cardápio salvo / catálogo).
ALTER TABLE "quiosque"."SessaoCaixaProdutoQuiosque"
ADD COLUMN "precoUnit" DECIMAL(10,2);
