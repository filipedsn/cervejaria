import { prisma } from './prisma.js';

function namesMatch(a: string, b: string) {
  return a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'accent' }) === 0;
}

/** Resolve ou cria cliente para nova comanda; atualiza nome se identificado pelo telefone. */
export async function resolveClienteParaComanda(params: {
  cervejariaId: string;
  nome: string;
  telefone?: string | null;
}) {
  const nome = params.nome.trim();
  const telefone = params.telefone?.trim() || null;

  let cliente = null;

  if (telefone) {
    cliente = await prisma.cliente.findFirst({
      where: { cervejariaId: params.cervejariaId, telefone },
    });
    if (cliente && !namesMatch(cliente.nome, nome)) {
      cliente = await prisma.cliente.update({
        where: { id: cliente.id },
        data: { nome },
      });
    }
  }

  if (!cliente) {
    cliente = await prisma.cliente.findFirst({
      where: {
        cervejariaId: params.cervejariaId,
        nome: { equals: nome, mode: 'insensitive' },
        telefone,
      },
    });
  }

  if (!cliente) {
    cliente = await prisma.cliente.create({
      data: {
        nome,
        telefone,
        cervejariaId: params.cervejariaId,
      },
    });
  }

  return cliente;
}
