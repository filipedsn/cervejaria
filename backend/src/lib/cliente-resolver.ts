import type { CadastroOrigem } from '@prisma/client';
import { prisma } from './prisma.js';
import { normalizePhone } from './phone.js';

function namesMatch(a: string, b: string) {
  return a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'accent' }) === 0;
}

export type ResolveClienteParams = {
  cervejariaId: string;
  nome: string;
  telefone: string;
  cadastradoVia?: CadastroOrigem;
};

/** Resolve ou cria cliente para nova comanda; telefone é obrigatório e chave de negócio. */
export async function resolveClienteParaComanda(params: ResolveClienteParams) {
  const nome = params.nome.trim();
  const telefone = normalizePhone(params.telefone);
  if (!telefone) {
    throw new Error('Telefone inválido');
  }
  const cadastradoVia = params.cadastradoVia ?? 'COMANDA';

  let cliente = await prisma.cliente.findFirst({
    where: { cervejariaId: params.cervejariaId, telefone },
  });

  if (cliente) {
    if (!namesMatch(cliente.nome, nome)) {
      cliente = await prisma.cliente.update({
        where: { id: cliente.id },
        data: { nome },
      });
    }
    return cliente;
  }

  return prisma.cliente.create({
    data: {
      nome,
      telefone,
      cervejariaId: params.cervejariaId,
      cadastradoVia,
    },
  });
}

export type RegisterClientePublicParams = {
  cervejariaId: string;
  nome: string;
  telefone: string;
  email?: string | null;
  optInMarketing: boolean;
};

/** Cadastro público ou staff — telefone obrigatório. */
export async function registerOrUpdateCliente(params: RegisterClientePublicParams & { cadastradoVia: CadastroOrigem }) {
  const nome = params.nome.trim();
  const telefone = normalizePhone(params.telefone);
  if (!telefone) {
    throw new Error('Telefone inválido');
  }

  const now = new Date();
  return prisma.cliente.upsert({
    where: {
      cervejariaId_telefone: {
        cervejariaId: params.cervejariaId,
        telefone,
      },
    },
    create: {
      nome,
      telefone,
      email: params.email?.trim() || null,
      optInMarketing: params.optInMarketing,
      optInEm: params.optInMarketing ? now : null,
      cadastradoVia: params.cadastradoVia,
      cervejariaId: params.cervejariaId,
    },
    update: {
      nome,
      ...(params.email !== undefined ? { email: params.email?.trim() || null } : {}),
      optInMarketing: params.optInMarketing,
      optInEm: params.optInMarketing ? now : undefined,
      ativo: true,
    },
  });
}
