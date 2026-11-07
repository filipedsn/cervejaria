-- TAP-181: Bar como segunda estação de preparo. Aditiva; tudo nasce desligado
-- e os produtos/itens existentes continuam na Cozinha.
CREATE TYPE "public"."EstacaoPreparo" AS ENUM ('COZINHA', 'BAR');

ALTER TABLE "public"."Produto"
ADD COLUMN "estacaoPreparo" "public"."EstacaoPreparo" NOT NULL DEFAULT 'COZINHA';

ALTER TABLE "public"."ItemComanda"
ADD COLUMN "estacaoPreparo" "public"."EstacaoPreparo" NOT NULL DEFAULT 'COZINHA';

ALTER TABLE "public"."ConfiguracaoOperacional"
ADD COLUMN "barEnabled" BOOLEAN,
ADD COLUMN "barItemsChargeAtLaunch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allowCloseComandaWithPendingBarOrders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "whatsappPedidoProntoNoBar" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "quiosque"."ConfiguracaoPontoVenda"
ADD COLUMN "barEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "barItemsChargeAtLaunch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allowCloseComandaWithPendingBarOrders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "whatsappPedidoProntoNoBar" BOOLEAN NOT NULL DEFAULT false;
