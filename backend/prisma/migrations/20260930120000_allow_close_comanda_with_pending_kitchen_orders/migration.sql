ALTER TABLE "public"."ConfiguracaoOperacional"
ADD COLUMN "allowCloseComandaWithPendingKitchenOrders" BOOLEAN NOT NULL DEFAULT false;
