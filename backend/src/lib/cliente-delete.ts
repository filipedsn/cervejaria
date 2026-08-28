import { prisma } from './prisma.js';

const STATUS_BLOQUEIA_EXCLUSAO = ['ABERTA', 'FECHADA'] as const;

export interface ClienteExclusaoMeta {
  podeExcluir: boolean;
  motivoExclusao: string | null;
  comandasAbertas: number;
  comandasFechadas: number;
}

export interface ClienteComandaCounts {
  abertas: number;
  fechadas: number;
}

export function buildExclusaoMeta(
  isSistema: boolean,
  counts: ClienteComandaCounts,
): ClienteExclusaoMeta {
  const { abertas: comandasAbertas, fechadas: comandasFechadas } = counts;

  if (isSistema) {
    return {
      podeExcluir: false,
      motivoExclusao: 'Cliente de sistema não pode ser excluído.',
      comandasAbertas,
      comandasFechadas,
    };
  }

  if (comandasAbertas > 0) {
    const n = comandasAbertas;
    return {
      podeExcluir: false,
      motivoExclusao: `Possui ${n} comanda${n === 1 ? '' : 's'} aberta${n === 1 ? '' : 's'}. Feche ou cancele antes de excluir.`,
      comandasAbertas,
      comandasFechadas,
    };
  }

  if (comandasFechadas > 0) {
    const n = comandasFechadas;
    return {
      podeExcluir: false,
      motivoExclusao: `Possui ${n} comanda${n === 1 ? '' : 's'} fechada${n === 1 ? '' : 's'} com consumo registrado.`,
      comandasAbertas,
      comandasFechadas,
    };
  }

  return {
    podeExcluir: true,
    motivoExclusao: null,
    comandasAbertas: 0,
    comandasFechadas: 0,
  };
}

export async function getClienteComandaCounts(clienteId: string): Promise<ClienteComandaCounts> {
  const [abertas, fechadas] = await Promise.all([
    prisma.comanda.count({ where: { clienteId, status: 'ABERTA' } }),
    prisma.comanda.count({ where: { clienteId, status: 'FECHADA' } }),
  ]);
  return { abertas, fechadas };
}

export async function getComandaCountsByClienteIds(
  clienteIds: string[],
): Promise<Map<string, ClienteComandaCounts>> {
  const map = new Map<string, ClienteComandaCounts>();
  if (!clienteIds.length) return map;

  for (const id of clienteIds) {
    map.set(id, { abertas: 0, fechadas: 0 });
  }

  const rows = await prisma.comanda.groupBy({
    by: ['clienteId', 'status'],
    where: {
      clienteId: { in: clienteIds },
      status: { in: ['ABERTA', 'FECHADA'] },
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (!row.clienteId) continue;
    const current = map.get(row.clienteId) ?? { abertas: 0, fechadas: 0 };
    if (row.status === 'ABERTA') current.abertas = row._count._all;
    if (row.status === 'FECHADA') current.fechadas = row._count._all;
    map.set(row.clienteId, current);
  }

  return map;
}

/** Comanda aberta ou fechada = consumo real; canceladas não bloqueiam exclusão. */
export async function clienteTemConsumo(clienteId: string): Promise<boolean> {
  const counts = await getClienteComandaCounts(clienteId);
  return counts.abertas + counts.fechadas > 0;
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

  const counts = await getClienteComandaCounts(clienteId);
  const meta = buildExclusaoMeta(cliente.isSistema, counts);
  return meta.motivoExclusao;
}

export { STATUS_BLOQUEIA_EXCLUSAO };
