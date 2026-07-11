CREATE TYPE "FormatoBebida" AS ENUM ('CHOPE', 'LATA', 'LONGNECK', 'GARRAFA', 'OUTRO');

ALTER TABLE "Produto" ADD COLUMN "formato" "FormatoBebida";

UPDATE "Produto" SET "formato" = 'CHOPE' WHERE "tipo" = 'BEBIDA';
