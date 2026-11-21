-- TAP-183: combos customizados. Aditiva; produtos e itens existentes não mudam.
ALTER TABLE "public"."Produto"
ADD COLUMN "combo" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "public"."ItemComanda"
ADD COLUMN "comboInstanciaId" TEXT,
ADD COLUMN "comboProdutoId" TEXT,
ADD COLUMN "comboNome" TEXT,
ADD COLUMN "comboGrupoNome" TEXT;

CREATE INDEX "ItemComanda_comboInstanciaId_idx" ON "public"."ItemComanda"("comboInstanciaId");

CREATE TABLE "public"."ComboGrupo" (
  "id" TEXT NOT NULL,
  "comboProdutoId" TEXT NOT NULL,
  "cervejariaId" TEXT NOT NULL,
  "nome" VARCHAR(80) NOT NULL,
  "minimo" INTEGER NOT NULL DEFAULT 1,
  "maximo" INTEGER NOT NULL DEFAULT 1,
  "somenteCardapioTurno" BOOLEAN NOT NULL DEFAULT false,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComboGrupo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ComboGrupoOpcao" (
  "id" TEXT NOT NULL,
  "grupoId" TEXT NOT NULL,
  "produtoId" TEXT NOT NULL,
  "precoNoCombo" DECIMAL(10,2) NOT NULL,
  "quantidade" INTEGER NOT NULL DEFAULT 1,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ComboGrupoOpcao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComboGrupo_comboProdutoId_ordem_idx" ON "public"."ComboGrupo"("comboProdutoId", "ordem");
CREATE UNIQUE INDEX "ComboGrupoOpcao_grupoId_produtoId_key" ON "public"."ComboGrupoOpcao"("grupoId", "produtoId");
CREATE INDEX "ComboGrupoOpcao_produtoId_idx" ON "public"."ComboGrupoOpcao"("produtoId");

ALTER TABLE "public"."ComboGrupo"
ADD CONSTRAINT "ComboGrupo_comboProdutoId_fkey" FOREIGN KEY ("comboProdutoId") REFERENCES "public"."Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ComboGrupoOpcao"
ADD CONSTRAINT "ComboGrupoOpcao_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "public"."ComboGrupo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ComboGrupoOpcao"
ADD CONSTRAINT "ComboGrupoOpcao_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "public"."Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
