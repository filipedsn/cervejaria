-- Per-item balcão attendance (Solicitado → Atendido) for portal / counter alert items.
ALTER TABLE "ItemComanda" ADD COLUMN "balcaoAtendidoEm" TIMESTAMP(3);
