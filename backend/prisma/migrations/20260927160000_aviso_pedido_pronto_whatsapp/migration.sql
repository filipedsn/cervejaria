ALTER TABLE "public"."ConfiguracaoOperacional"
ADD COLUMN "whatsappPedidoProntoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "whatsappPedidoProntoNaCozinha" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "quiosque"."PedidoQuiosque"
ADD COLUMN "clienteAvisadoEm" TIMESTAMP(3);
