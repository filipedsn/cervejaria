-- Keep existing staff permissions while converging the runtime field name.
ALTER TABLE "public"."Usuario"
  RENAME COLUMN "podeDarDescontoQuiosque" TO "podeDarDescontoOperacao";
