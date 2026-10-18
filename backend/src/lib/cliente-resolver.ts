import type { CadastroOrigem } from '@prisma/client';
import { prisma } from './prisma.js';
import { normalizePhone } from './phone.js';

function namesMatch(a: string, b: string) {
  return a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'accent' }) === 0;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export class TelefoneConflitoError extends Error {
  readonly outroNome: string;

  constructor(outroNome: string) {
    super(`Telefone já cadastrado para ${outroNome}`);
    this.name = 'TelefoneConflitoError';
    this.outroNome = outroNome;
  }
}

/** Busca por telefone lógico, inclusive registros antigos salvos com máscara ou +55. */
export async function findClienteByTelefone(
  cervejariaId: string,
  telefone: string,
  excludeClienteId?: string,
) {
  const matches = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH normalized AS (
      SELECT c.id,
        CASE
          WHEN left(regexp_replace(c.telefone, '[^0-9]', '', 'g'), 2) = '55'
            AND length(regexp_replace(c.telefone, '[^0-9]', '', 'g')) IN (12, 13)
          THEN substring(regexp_replace(c.telefone, '[^0-9]', '', 'g') FROM 3)
          ELSE left(regexp_replace(c.telefone, '[^0-9]', '', 'g'), 11)
        END AS telefone_normalizado
      FROM "Cliente" c
      WHERE c."cervejariaId" = ${cervejariaId}
        AND c.telefone IS NOT NULL
        AND (${excludeClienteId ?? null}::text IS NULL OR c.id <> ${excludeClienteId ?? null})
    )
    SELECT id FROM normalized WHERE telefone_normalizado = ${telefone} LIMIT 1
  `;
  if (!matches[0]) return null;
  return prisma.cliente.findUnique({
    where: { id: matches[0].id },
    select: { id: true, nome: true },
  });
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
  const existing = await findClienteByTelefone(cervejariaId, telefone, excludeClienteId);
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
  const existing = await findClienteByTelefone(cervejariaId, telefone);
  let cliente = existing ? await prisma.cliente.findUnique({ where: { id: existing.id } }) : null;

  if (cliente) {
    if (!namesMatch(cliente.nome, nome)) {
      cliente = await prisma.cliente.update({
        where: { id: cliente.id },
        data: { nome },
      });
    }
    return cliente;
  }

  try {
    return await prisma.cliente.create({
      data: {
        nome,
        telefone,
        cervejariaId,
        cadastradoVia,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrent = await findClienteByTelefone(cervejariaId, telefone);
    if (!concurrent) throw error;
    return prisma.cliente.findUniqueOrThrow({ where: { id: concurrent.id } });
  }
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

  const existing = await findClienteByTelefone(params.cervejariaId, telefone);
  const now = new Date();
  const data = {
    nome,
    email: params.email?.trim() || null,
    optInMarketing: params.optInMarketing,
    optInEm: params.optInMarketing ? now : null,
    ativo: true,
  };
  if (existing) {
    return prisma.cliente.update({
      where: { id: existing.id },
      data: {
        nome,
        ...(params.email !== undefined ? { email: params.email?.trim() || null } : {}),
        optInMarketing: params.optInMarketing,
        optInEm: params.optInMarketing ? now : undefined,
        ativo: true,
      },
    });
  }
  try {
    return await prisma.cliente.create({
      data: {
        ...data,
        telefone,
        cadastradoVia: params.cadastradoVia,
        cervejariaId: params.cervejariaId,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrent = await findClienteByTelefone(params.cervejariaId, telefone);
    if (!concurrent) throw error;
    return prisma.cliente.update({
      where: { id: concurrent.id },
      data: {
        nome,
        ...(params.email !== undefined ? { email: params.email?.trim() || null } : {}),
        optInMarketing: params.optInMarketing,
        optInEm: params.optInMarketing ? now : undefined,
        ativo: true,
      },
    });
  }
}
