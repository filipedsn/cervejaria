ALTER TABLE "public"."ItemComanda"
  ADD COLUMN IF NOT EXISTS "observacao" TEXT;

CREATE TABLE IF NOT EXISTS "public"."ProdutoOpcionalGrupo" (
  "id" TEXT NOT NULL,
  "produtoId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "obrigatorio" BOOLEAN NOT NULL DEFAULT false,
  "maximo" INTEGER NOT NULL DEFAULT 1,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProdutoOpcionalGrupo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."ProdutoOpcional" (
  "id" TEXT NOT NULL,
  "grupoId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "precoAdicional" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "produtoEstoqueId" TEXT,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProdutoOpcional_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."ItemComandaOpcional" (
  "id" TEXT NOT NULL,
  "itemComandaId" TEXT NOT NULL,
  "opcionalId" TEXT,
  "nome" TEXT NOT NULL,
  "precoAdicional" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "quantidade" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ItemComandaOpcional_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProdutoOpcionalGrupo_produtoId_ativo_ordem_idx"
  ON "public"."ProdutoOpcionalGrupo"("produtoId", "ativo", "ordem");
CREATE INDEX IF NOT EXISTS "ProdutoOpcional_grupoId_ativo_ordem_idx"
  ON "public"."ProdutoOpcional"("grupoId", "ativo", "ordem");
CREATE INDEX IF NOT EXISTS "ProdutoOpcional_produtoEstoqueId_idx"
  ON "public"."ProdutoOpcional"("produtoEstoqueId");
CREATE INDEX IF NOT EXISTS "ItemComandaOpcional_itemComandaId_idx"
  ON "public"."ItemComandaOpcional"("itemComandaId");
CREATE INDEX IF NOT EXISTS "ItemComandaOpcional_opcionalId_idx"
  ON "public"."ItemComandaOpcional"("opcionalId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProdutoOpcionalGrupo_produtoId_fkey') THEN
    ALTER TABLE "public"."ProdutoOpcionalGrupo"
      ADD CONSTRAINT "ProdutoOpcionalGrupo_produtoId_fkey"
      FOREIGN KEY ("produtoId") REFERENCES "public"."Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProdutoOpcional_grupoId_fkey') THEN
    ALTER TABLE "public"."ProdutoOpcional"
      ADD CONSTRAINT "ProdutoOpcional_grupoId_fkey"
      FOREIGN KEY ("grupoId") REFERENCES "public"."ProdutoOpcionalGrupo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProdutoOpcional_produtoEstoqueId_fkey') THEN
    ALTER TABLE "public"."ProdutoOpcional"
      ADD CONSTRAINT "ProdutoOpcional_produtoEstoqueId_fkey"
      FOREIGN KEY ("produtoEstoqueId") REFERENCES "public"."Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ItemComandaOpcional_itemComandaId_fkey') THEN
    ALTER TABLE "public"."ItemComandaOpcional"
      ADD CONSTRAINT "ItemComandaOpcional_itemComandaId_fkey"
      FOREIGN KEY ("itemComandaId") REFERENCES "public"."ItemComanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ItemComandaOpcional_opcionalId_fkey') THEN
    ALTER TABLE "public"."ItemComandaOpcional"
      ADD CONSTRAINT "ItemComandaOpcional_opcionalId_fkey"
      FOREIGN KEY ("opcionalId") REFERENCES "public"."ProdutoOpcional"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
