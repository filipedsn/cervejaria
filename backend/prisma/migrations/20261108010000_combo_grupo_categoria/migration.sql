-- TAP-183: grupos de combo por categoria (monte o seu) com preço fixo ou de catálogo.
CREATE TYPE "public"."ComboGrupoModo" AS ENUM ('LISTA', 'CATEGORIA');
CREATE TYPE "public"."ComboGrupoPrecoModo" AS ENUM ('FIXO', 'CATALOGO');

ALTER TABLE "public"."ComboGrupo"
ADD COLUMN "modo" "public"."ComboGrupoModo" NOT NULL DEFAULT 'LISTA',
ADD COLUMN "categoria" VARCHAR(80),
ADD COLUMN "categoriaPdvId" TEXT,
ADD COLUMN "precoModo" "public"."ComboGrupoPrecoModo",
ADD COLUMN "precoFixo" DECIMAL(10,2);

CREATE INDEX "ComboGrupo_categoriaPdvId_idx" ON "public"."ComboGrupo"("categoriaPdvId");

ALTER TABLE "public"."ComboGrupo"
ADD CONSTRAINT "ComboGrupo_categoriaPdvId_cervejariaId_fkey"
FOREIGN KEY ("categoriaPdvId", "cervejariaId")
REFERENCES "public"."CategoriaProdutoPdv"("id", "cervejariaId")
ON DELETE RESTRICT ON UPDATE CASCADE;
