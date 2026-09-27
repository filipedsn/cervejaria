ALTER TABLE public."ItemComandaOpcional" ADD COLUMN IF NOT EXISTS "opcionalCatalogoId" text;
CREATE TABLE IF NOT EXISTS public."Opcional" (
  "id" text PRIMARY KEY,
  "cervejariaId" text NOT NULL,
  "nome" text NOT NULL,
  "preco" numeric(10,2) NOT NULL DEFAULT 0,
  "ativo" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public."ProdutoOpcionalVinculo" (
  "id" text PRIMARY KEY,
  "produtoId" text NOT NULL,
  "opcionalId" text NOT NULL,
  "ordem" integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "Opcional_cervejariaId_nome_key" ON public."Opcional"("cervejariaId", "nome");
CREATE INDEX IF NOT EXISTS "Opcional_cervejariaId_ativo_nome_idx" ON public."Opcional"("cervejariaId", "ativo", "nome");
CREATE UNIQUE INDEX IF NOT EXISTS "ProdutoOpcionalVinculo_produtoId_opcionalId_key" ON public."ProdutoOpcionalVinculo"("produtoId", "opcionalId");
CREATE INDEX IF NOT EXISTS "ProdutoOpcionalVinculo_produtoId_ordem_idx" ON public."ProdutoOpcionalVinculo"("produtoId", "ordem");
CREATE INDEX IF NOT EXISTS "ItemComandaOpcional_opcionalCatalogoId_idx" ON public."ItemComandaOpcional"("opcionalCatalogoId");
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Opcional_cervejariaId_fkey') THEN ALTER TABLE public."Opcional" ADD CONSTRAINT "Opcional_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES public."Cervejaria"("id") ON DELETE CASCADE; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProdutoOpcionalVinculo_produtoId_fkey') THEN ALTER TABLE public."ProdutoOpcionalVinculo" ADD CONSTRAINT "ProdutoOpcionalVinculo_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES public."Produto"("id") ON DELETE CASCADE; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProdutoOpcionalVinculo_opcionalId_fkey') THEN ALTER TABLE public."ProdutoOpcionalVinculo" ADD CONSTRAINT "ProdutoOpcionalVinculo_opcionalId_fkey" FOREIGN KEY ("opcionalId") REFERENCES public."Opcional"("id") ON DELETE CASCADE; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ItemComandaOpcional_opcionalCatalogoId_fkey') THEN ALTER TABLE public."ItemComandaOpcional" ADD CONSTRAINT "ItemComandaOpcional_opcionalCatalogoId_fkey" FOREIGN KEY ("opcionalCatalogoId") REFERENCES public."Opcional"("id") ON DELETE SET NULL; END IF;
END $$;
