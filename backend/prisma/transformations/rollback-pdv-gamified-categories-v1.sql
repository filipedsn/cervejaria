-- Rollback da transformação apenas; preserva categorias criadas manualmente.
BEGIN;
UPDATE "Produto" p
SET "categoriaPdvId" = NULL
FROM "CategoriaProdutoPdv" c
WHERE p."categoriaPdvId" = c."id"
  AND p."cervejariaId" = c."cervejariaId"
  AND c."origemMigracao" = 'categoria-historica-v1';

DELETE FROM "CategoriaProdutoPdv" c
WHERE c."origemMigracao" = 'categoria-historica-v1'
  AND NOT EXISTS (
    SELECT 1 FROM "Produto" p
    WHERE p."categoriaPdvId" = c."id" AND p."cervejariaId" = c."cervejariaId"
  );
COMMIT;
