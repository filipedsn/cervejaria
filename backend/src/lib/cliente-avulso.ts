import type { Prisma } from '@prisma/client';

/** Telefone reservado para o cliente sistema de vendas avulsas (por cervejaria). */
export const TELEFONE_CLIENTE_AVULSO = '00000000000';

export const NOME_CLIENTE_AVULSO = 'Consumidor avulso';

export function isTelefoneClienteAvulsoReservado(telefone: string | null | undefined): boolean {
  if (!telefone) return false;
  const digits = telefone.replace(/\D/g, '');
  return digits === TELEFONE_CLIENTE_AVULSO;
}

type DbClient = Prisma.TransactionClient | typeof import('./prisma.js').prisma;

export async function ensureClienteAvulso(db: DbClient, cervejariaId: string) {
  const existing = await db.cliente.findFirst({
    where: { cervejariaId, telefone: TELEFONE_CLIENTE_AVULSO },
  });
  if (existing) return existing;

  return db.cliente.create({
    data: {
      cervejariaId,
      nome: NOME_CLIENTE_AVULSO,
      telefone: TELEFONE_CLIENTE_AVULSO,
      isSistema: true,
      ativo: false,
      cadastradoVia: 'STAFF',
    },
  });
}
