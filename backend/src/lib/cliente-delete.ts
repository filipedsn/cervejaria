import { prisma } from './prisma.js';

const STATUS_BLOQUEIA_EXCLUSAO = ['ABERTA', 'FECHADA'] as const;

/** Comanda aberta ou fechada = consumo real; canceladas não bloqueiam exclusão. */
export async function clienteTemConsumo(clienteId: string): Promise<boolean> {
  const count = await prisma.comanda.count({
    where: {
      clienteId,
      status: { in: [...STATUS_BLOQUEIA_EXCLUSAO] },
    },
  });
  return count > 0;
}

export async function assertClientePodeExcluir(
  clienteId: string,
  cervejariaId: string,
): Promise<string | null> {
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, cervejariaId },
    select: { id: true, isSistema: true },
  });

  if (!cliente) return 'Cliente não encontrado';
  if (cliente.isSistema) return 'Cliente de sistema não pode ser excluído';

  if (await clienteTemConsumo(clienteId)) {
    return 'Cliente possui consumo registrado ou comanda aberta e não pode ser excluído.';
  }

  return null;
}

export { STATUS_BLOQUEIA_EXCLUSAO };
