-- Unifica o cardápio de evento e o cardápio de turno em public.Cardapio.
-- A flag global fica em public.Cervejaria.usaCardapio; o valor verdadeiro
-- vence quando os dois modelos antigos estiverem divergentes.
BEGIN;

UPDATE "public"."Cervejaria" c
SET "usaCardapio" = true
FROM "quiosque"."ConfiguracaoQuiosque" q
WHERE q."cervejariaId" = c."id"
  AND q."usaCardapio" = true;

CREATE TEMP TABLE "_CardapioOperacaoMap" ON COMMIT DROP AS
SELECT
  q."id" AS "oldId",
  'op_' || q."id" AS "newId"
FROM "quiosque"."CardapioQuiosque" q;

INSERT INTO "public"."Cardapio" (
  "id", "nome", "ativo", "cervejariaId", "createdAt", "updatedAt"
)
SELECT
  m."newId", q."nome", q."ativo", q."cervejariaId", q."createdAt", q."updatedAt"
FROM "quiosque"."CardapioQuiosque" q
JOIN "_CardapioOperacaoMap" m ON m."oldId" = q."id";

INSERT INTO "public"."CardapioProduto" (
  "id", "cardapioId", "produtoId", "precoUnit"
)
SELECT
  'op_item_' || p."id", m."newId", p."produtoId", p."precoUnit"
FROM "quiosque"."CardapioQuiosqueProduto" p
JOIN "_CardapioOperacaoMap" m ON m."oldId" = p."cardapioId";

ALTER TABLE "quiosque"."SessaoCaixaQuiosque"
  ADD COLUMN "cardapioId" TEXT;

UPDATE "quiosque"."SessaoCaixaQuiosque" s
SET "cardapioId" = m."newId"
FROM "_CardapioOperacaoMap" m
WHERE s."cardapioQuiosqueId" = m."oldId";

ALTER TABLE "quiosque"."SessaoCaixaQuiosque"
  ADD CONSTRAINT "SessaoCaixaQuiosque_cardapioId_fkey"
  FOREIGN KEY ("cardapioId") REFERENCES "public"."Cardapio"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SessaoCaixaQuiosque_cardapioId_idx"
  ON "quiosque"."SessaoCaixaQuiosque"("cardapioId");

ALTER TABLE "quiosque"."SessaoCaixaQuiosque"
  DROP CONSTRAINT IF EXISTS "SessaoCaixaQuiosque_cardapioQuiosqueId_fkey";
DROP INDEX IF EXISTS "quiosque"."SessaoCaixaQuiosque_cardapioQuiosqueId_idx";
ALTER TABLE "quiosque"."SessaoCaixaQuiosque"
  DROP COLUMN "cardapioQuiosqueId";

ALTER TABLE "quiosque"."ConfiguracaoQuiosque"
  DROP COLUMN "usaCardapio";

DROP TABLE "quiosque"."CardapioQuiosqueProduto";
DROP TABLE "quiosque"."CardapioQuiosque";

COMMIT;
