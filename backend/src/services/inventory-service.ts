import type { Prisma } from '@prisma/client';
import type { ItemResolvido } from '../lib/operacao/venda.js';
import {
  baixarEstoqueDoPedido,
  estornarEstoqueDaComanda,
} from '../lib/operacao/estoque.js';

export type OperationalContext = 'CAIXA' | 'EVENTO';

export type InventoryProduct = Pick<ItemResolvido, 'produtoId' | 'nome' | 'quantidade' | 'controlaEstoque'>;

export interface InventoryService {
  participates(product: Pick<InventoryProduct, 'controlaEstoque'>, context: OperationalContext): boolean;
  consumeSale(
    tx: Prisma.TransactionClient,
    params: {
      context: OperationalContext;
      moduleEnabled: boolean;
      cervejariaId: string;
      pontoVendaId: string;
      pedidoId: string;
      registradoPorId: string;
      items: ItemResolvido[];
    },
  ): Promise<void>;
  reverseComanda(
    tx: Prisma.TransactionClient,
    params: {
      context: OperationalContext;
      moduleEnabled: boolean;
      cervejariaId: string;
      comandaId: string;
      registradoPorId: string;
    },
  ): Promise<void>;
}

/** Canonical inventory boundary shared by every operational context. */
export const inventoryService: InventoryService = {
  participates(product, _context) {
    return product.controlaEstoque;
  },

  consumeSale(tx, params) {
    return baixarEstoqueDoPedido(tx, {
      moduloControlaEstoque: params.moduleEnabled,
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      pedidoId: params.pedidoId,
      registradoPorId: params.registradoPorId,
      itens: params.items,
    });
  },

  reverseComanda(tx, params) {
    return estornarEstoqueDaComanda(tx, {
      moduloControlaEstoque: params.moduleEnabled,
      cervejariaId: params.cervejariaId,
      comandaId: params.comandaId,
      registradoPorId: params.registradoPorId,
    });
  },
};
