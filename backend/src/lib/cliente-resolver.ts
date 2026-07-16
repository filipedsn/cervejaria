import type { CadastroOrigem } from '@prisma/client';
import { prisma } from './prisma.js';
import { normalizePhone } from './phone.js';

function namesMatch(a: string, b: string) {
  return a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'accent' }) === 0;
}

export class TelefoneConflitoError extends Error {
  readonly outroNome: string;

  constructor(outroNome: string) {
    super(`Telefone já cadastrado para ${outroNome}`);
    this.name = 'TelefoneConflitoError';
    this.outroNome = outroNome;
  }
}

export type ResolveClienteParams = {
  cervejariaId: string;
  nome: string;
  telefone?: string;
  clienteId?: string;
  cadastradoVia?: CadastroOrigem;
};

export async function assertTelefoneDisponivel(
  cervejariaId: string,
  telefone: string,
  excludeClienteId?: string,
) {
  const existing = await prisma.cliente.findFirst({
    where: {
      cervejariaId,
      telefone,
      ...(excludeClienteId ? { NOT: { id: excludeClienteId } } : {}),
    },
    select: { id: true, nome: true },
  });
  if (existing) {
    throw new TelefoneConflitoError(existing.nome);
  }
}

export async function vincularTelefoneSeVazio(
  clienteId: string,
  telefone: string,
  cervejariaId: string,
) {
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, cervejariaId, isSistema: false },
  });
  if (!cliente) throw new Error('Cliente não encontrado');
  if (cliente.telefone === telefone) return cliente;
  if (cliente.telefone) {
    throw new Error('Cliente já possui outro telefone cadastrado');
  }

  await assertTelefoneDisponivel(cervejariaId, telefone, clienteId);
  return prisma.cliente.update({
    where: { id: clienteId },
    data: { telefone },
  });
}

async function resolveByTelefone(
  cervejariaId: string,
  nome: string,
  telefone: string,
  cadastradoVia: CadastroOrigem,
) {
  let cliente = await prisma.cliente.findFirst({
    where: { cervejariaId, telefone },
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
      cervejariaId,
      cadastradoVia,
    },
  });
}

async function resolveByNomeLegado(
  cervejariaId: string,
  nome: string,
  cadastradoVia: CadastroOrigem,
) {
  const legacy = await prisma.cliente.findFirst({
    where: {
      cervejariaId,
      telefone: null,
      nome: { equals: nome, mode: 'insensitive' },
      isSistema: false,
      ativo: true,
    },
  });
  if (legacy) return legacy;

  return prisma.cliente.create({
    data: {
      nome,
      telefone: null,
      cervejariaId,
      cadastradoVia,
    },
  });
}

/** Resolve ou cria cliente para nova comanda. */
export async function resolveClienteParaComanda(params: ResolveClienteParams) {
  const nome = params.nome.trim();
  if (!nome) throw new Error('Nome do cliente é obrigatório');

  const cadastradoVia = params.cadastradoVia ?? 'COMANDA';
  const telefone = params.telefone ? normalizePhone(params.telefone) : null;
  if (params.telefone && !telefone) {
    throw new Error('Telefone inválido');
  }

  if (params.clienteId) {
    let cliente = await prisma.cliente.findFirst({
      where: {
        id: params.clienteId,
        cervejariaId: params.cervejariaId,
        isSistema: false,
        ativo: true,
      },
    });
    if (!cliente) throw new Error('Cliente não encontrado');

    if (telefone) {
      cliente = await vincularTelefoneSeVazio(cliente.id, telefone, params.cervejariaId);
    }

    if (!namesMatch(cliente.nome, nome)) {
      cliente = await prisma.cliente.update({
        where: { id: cliente.id },
        data: { nome },
      });
    }
    return cliente;
  }

  if (telefone) {
    return resolveByTelefone(params.cervejariaId, nome, telefone, cadastradoVia);
  }

  return resolveByNomeLegado(params.cervejariaId, nome, cadastradoVia);
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
