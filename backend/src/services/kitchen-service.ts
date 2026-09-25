import type { Prisma, StatusPedidoOperacao } from '@prisma/client';
import {
  aplicarStatusPedidoCozinha,
  INCLUDE_PEDIDO_COZINHA,
} from '../lib/operacao/cozinha.js';

export type OperationalContext = 'CAIXA' | 'EVENTO';

export type KitchenProduct = { exigePreparo: boolean };

export interface KitchenService {
  participates(product: KitchenProduct, context: OperationalContext): boolean;
  applyStatus(
    tx: Prisma.TransactionClient,
    pedido: { id: string; status: StatusPedidoOperacao },
    status: StatusPedidoOperacao,
  ): Promise<Prisma.PedidoOperacaoGetPayload<{ include: typeof INCLUDE_PEDIDO_COZINHA }>>;
}

/** Canonical kitchen boundary shared by every operational context. */
export const kitchenService: KitchenService = {
  participates(product, _context) {
    return product.exigePreparo;
  },

  applyStatus(tx, pedido, status) {
    return aplicarStatusPedidoCozinha(tx, pedido, status);
  },
};
