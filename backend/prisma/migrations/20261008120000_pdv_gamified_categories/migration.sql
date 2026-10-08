-- Base aditiva para categorias canônicas. A transformação do texto histórico
-- para IDs é ensaiada separadamente e não é executada por esta migration.
CREATE TABLE "CategoriaProdutoPdv" (
    "id" TEXT NOT NULL,
    "cervejariaId" TEXT NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "nomeNormalizado" VARCHAR(100) NOT NULL,
    "gamificada" BOOLEAN NOT NULL DEFAULT false,
    "origemMigracao" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CategoriaProdutoPdv_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Produto" ADD COLUMN "categoriaPdvId" TEXT;

CREATE UNIQUE INDEX "CategoriaProdutoPdv_id_cervejariaId_key"
    ON "CategoriaProdutoPdv"("id", "cervejariaId");
CREATE UNIQUE INDEX "CategoriaProdutoPdv_cervejariaId_nomeNormalizado_key"
    ON "CategoriaProdutoPdv"("cervejariaId", "nomeNormalizado");
CREATE INDEX "CategoriaProdutoPdv_cervejariaId_nome_idx"
    ON "CategoriaProdutoPdv"("cervejariaId", "nome");
CREATE INDEX "Produto_categoriaPdvId_cervejariaId_idx"
    ON "Produto"("categoriaPdvId", "cervejariaId");

ALTER TABLE "CategoriaProdutoPdv"
    ADD CONSTRAINT "CategoriaProdutoPdv_cervejariaId_fkey"
    FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Produto"
    ADD CONSTRAINT "Produto_categoriaPdvId_cervejariaId_fkey"
    FOREIGN KEY ("categoriaPdvId", "cervejariaId")
    REFERENCES "CategoriaProdutoPdv"("id", "cervejariaId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
