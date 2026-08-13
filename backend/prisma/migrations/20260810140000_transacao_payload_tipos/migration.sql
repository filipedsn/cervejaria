-- Tipos adicionais de transacao (pedido, pagamento, fechamento em grupo).

ALTER TYPE "public"."TransacaoTipo" ADD VALUE IF NOT EXISTS 'QUIOSQUE_PEDIDO_CRIADO';
ALTER TYPE "public"."TransacaoTipo" ADD VALUE IF NOT EXISTS 'QUIOSQUE_PAGAMENTO_REGISTRADO';
ALTER TYPE "public"."TransacaoTipo" ADD VALUE IF NOT EXISTS 'QUIOSQUE_COMANDA_GRUPO_FECHADO';
