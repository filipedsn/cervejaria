import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getTenantUser } from '../types/auth.js';
import { resolveClienteParaComanda } from '../lib/cliente-resolver.js';
import { normalizePhone, formatPhoneBr } from '../lib/phone.js';
import { toNumber } from '../lib/utils.js';
import { assertClientePodeExcluir, buildExclusaoMeta, getComandaCountsByClienteIds, getClienteComandaCounts } from '../lib/cliente-delete.js';
import { ClienteMergeError, mergeClientes } from '../lib/cliente-merge.js';
import { requireDonoAtual, requirePermissao } from '../lib/operacao/permissoes.js';
import { notificarComandaOperacaoAtualizada } from '../lib/operacao/cozinha.js';

const createClienteSchema = z.object({
  nome: z.string().min(1),
  telefone: z.string().min(1, 'Telefone é obrigatório'),
  email: z.string().email().optional().nullable(),
  dataNascimento: z.string().datetime().optional().nullable(),
  optInMarketing: z.boolean().optional(),
  observacoes: z.string().optional().nullable(),
});

const patchClienteSchema = z.object({
  nome: z.string().min(1).optional(),
  telefone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  dataNascimento: z.string().datetime().optional().nullable(),
  optInMarketing: z.boolean().optional(),
  observacoes: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
});

const listQuerySchema = z.object({
  q: z.string().optional(),
  ordenar: z.enum(['ultimaVisita', 'nome', 'totalGasto']).optional().default('ultimaVisita'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const historicoQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

const clienteInclude = {
  estatisticas: true,
} satisfies Prisma.ClienteInclude;

function serializeCliente(
  cliente: Prisma.ClienteGetPayload<{ include: typeof clienteInclude }>,
  exclusao = buildExclusaoMeta(cliente.isSistema, { abertas: 0, fechadas: 0 }),
  valorPendente = 0,
) {
  return {
    ...cliente,
    telefone: cliente.telefone ? formatPhoneBr(cliente.telefone) : null,
    totalGasto: cliente.estatisticas ? toNumber(cliente.estatisticas.totalGasto) : 0,
    valorPendente,
    estatisticas: cliente.estatisticas
      ? {
          ...cliente.estatisticas,
          totalGasto: toNumber(cliente.estatisticas.totalGasto),
        }
      : null,
    podeExcluir: exclusao.podeExcluir,
    motivoExclusao: exclusao.motivoExclusao,
    comandasAbertas: exclusao.comandasAbertas,
    comandasFechadas: exclusao.comandasFechadas,
  };
}

async function getSaldosPendentesPorCliente(clienteIds: string[]) {
  const saldos = new Map<string, number>();
  if (clienteIds.length === 0) return saldos;

  const contas = await prisma.contaReceber.findMany({
    where: { clienteId: { in: clienteIds } },
    select: {
      clienteId: true,
      valorOriginal: true,
      pagamentos: { select: { valor: true } },
    },
  });
  for (const conta of contas) {
    const recebido = conta.pagamentos.reduce((soma, pagamento) => soma + toNumber(pagamento.valor), 0);
    const saldo = Math.max(0, Math.round((toNumber(conta.valorOriginal) - recebido) * 100) / 100);
    saldos.set(conta.clienteId, (saldos.get(conta.clienteId) ?? 0) + saldo);
  }
  return saldos;
}

async function serializeClienteWithExclusao(
  cliente: Prisma.ClienteGetPayload<{ include: typeof clienteInclude }>,
) {
  const [counts, saldos] = await Promise.all([
    getClienteComandaCounts(cliente.id),
    getSaldosPendentesPorCliente([cliente.id]),
  ]);
  return serializeCliente(cliente, buildExclusaoMeta(cliente.isSistema, counts), saldos.get(cliente.id) ?? 0);
}

function orderByFromSort(ordenar: string): Prisma.ClienteOrderByWithRelationInput[] {
  switch (ordenar) {
    case 'nome':
      return [{ nome: 'asc' }];
    case 'totalGasto':
      return [{ estatisticas: { totalGasto: 'desc' } }, { nome: 'asc' }];
    case 'ultimaVisita':
    default:
      return [{ estatisticas: { ultimaVisitaEm: 'desc' } }, { nome: 'asc' }];
  }
}

export async function clientesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: [requirePermissao(app, 'clients.manage')] }, async (request) => {
    const user = getTenantUser(app, request);
    const { q, ordenar, page, limit } = listQuerySchema.parse(request.query);
    const skip = (page - 1) * limit;

    const where: Prisma.ClienteWhereInput = {
      cervejariaId: user.cervejariaId,
      ativo: true,
      isSistema: false,
      ...(q
        ? {
            OR: [
              { nome: { contains: q, mode: 'insensitive' } },
              { telefone: { contains: normalizePhone(q) ?? q } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.cliente.findMany({
        where,
        include: clienteInclude,
        orderBy: orderByFromSort(ordenar),
        skip,
        take: limit,
      }),
      prisma.cliente.count({ where }),
    ]);

    const [countsByCliente, saldosPendentes] = await Promise.all([
      getComandaCountsByClienteIds(items.map((c) => c.id)),
      getSaldosPendentesPorCliente(items.map((c) => c.id)),
    ]);

    return {
      items: items.map((cliente) => {
        const counts = countsByCliente.get(cliente.id) ?? { abertas: 0, fechadas: 0 };
        return serializeCliente(
          cliente,
          buildExclusaoMeta(cliente.isSistema, counts),
          saldosPendentes.get(cliente.id) ?? 0,
        );
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  });

  app.get('/:id/historico', { preHandler: [requirePermissao(app, 'clients.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const { page, limit } = historicoQuerySchema.parse(request.query);
    const skip = (page - 1) * limit;

    const cliente = await prisma.cliente.findFirst({
      where: { id, cervejariaId: user.cervejariaId, isSistema: false },
      select: { id: true },
    });
    if (!cliente) return reply.status(404).send({ error: 'Cliente não encontrado' });

    const where = {
      clienteId: id,
      status: 'FECHADA' as const,
      tipo: { not: 'AVULSA' as const },
      pagamentos: { some: { valor: { gt: 0 } } },
    };

    const [comandas, total] = await Promise.all([
      prisma.comanda.findMany({
        where,
        include: {
          evento: { select: { id: true, nome: true, local: true, data: true } },
          pontoVenda: { select: { id: true, nome: true } },
          contaReceber: { select: { valorOriginal: true } },
          itens: {
            include: { produto: { select: { id: true, nome: true, tipo: true, formato: true } } },
            orderBy: { createdAt: 'asc' },
          },
          pagamentos: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.comanda.count({ where }),
    ]);

    return {
      items: comandas.map((c) => ({
        id: c.id,
        total: c.pagamentos.reduce((soma, pagamento) => soma + toNumber(pagamento.valor), 0),
        totalComanda: toNumber(c.total),
        valorPendente: c.contaReceber
          ? Math.max(0, toNumber(c.contaReceber.valorOriginal) - c.pagamentos.reduce((soma, pagamento) => soma + toNumber(pagamento.valor), 0))
          : 0,
        fechadaEm: c.fechadaEm ?? c.updatedAt,
        evento: c.evento ?? {
          id: c.pontoVenda?.id ?? c.id,
          nome: c.pontoVenda ? `Caixa · ${c.pontoVenda.nome}` : 'Caixa',
          local: '',
          data: null,
        },
        itens: c.itens.map((i) => ({
          id: i.id,
          produto: i.produto?.nome ?? i.nome,
          volumeMl: i.volumeMl,
          quantidade: i.quantidade,
          precoUnit: toNumber(i.precoUnit),
          subtotal: toNumber(i.precoUnit) * i.quantidade,
        })),
        pagamentos: c.pagamentos.map((p) => ({
          forma: p.forma,
          valor: toNumber(p.valor),
        })),
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  });

  app.get('/:id', { preHandler: [requirePermissao(app, 'clients.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };

    const cliente = await prisma.cliente.findFirst({
      where: { id, cervejariaId: user.cervejariaId, isSistema: false },
      include: clienteInclude,
    });
    if (!cliente) return reply.status(404).send({ error: 'Cliente não encontrado' });

    return serializeClienteWithExclusao(cliente);
  });

  app.post('/', { preHandler: [requirePermissao(app, 'clients.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const body = createClienteSchema.parse(request.body);
    const telefone = normalizePhone(body.telefone);

    if (!telefone) {
      return reply.status(400).send({ error: 'Telefone inválido. Informe DDD + número (10 ou 11 dígitos).' });
    }

    const existing = await prisma.cliente.findFirst({
      where: { cervejariaId: user.cervejariaId, telefone },
    });
    if (existing) {
      return reply.status(409).send({ error: 'Já existe cliente com este telefone', clienteId: existing.id });
    }

    const now = new Date();
    const cliente = await prisma.cliente.create({
      data: {
        nome: body.nome.trim(),
        telefone,
        email: body.email?.trim() || null,
        dataNascimento: body.dataNascimento ? new Date(body.dataNascimento) : null,
        optInMarketing: body.optInMarketing ?? false,
        optInEm: body.optInMarketing ? now : null,
        observacoes: body.observacoes?.trim() || null,
        cadastradoVia: 'STAFF',
        cervejariaId: user.cervejariaId!,
      },
      include: clienteInclude,
    });

    return reply.status(201).send(serializeCliente(cliente));
  });

  app.patch('/:id', { preHandler: [requirePermissao(app, 'clients.manage')] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = patchClienteSchema.parse(request.body);
    const persistedUser = await prisma.usuario.findFirst({
      where: { id: user.sub, cervejariaId: user.cervejariaId! },
      select: { papel: true },
    });
    const isDono = persistedUser?.papel === 'DONO';

    const existing = await prisma.cliente.findFirst({
      where: { id, cervejariaId: user.cervejariaId },
    });
    if (!existing) return reply.status(404).send({ error: 'Cliente não encontrado' });

    if (!isDono && (body.observacoes !== undefined || body.ativo !== undefined || body.optInMarketing !== undefined || body.email !== undefined || body.dataNascimento !== undefined)) {
      return reply.status(403).send({ error: 'Apenas o proprietário pode alterar estes campos' });
    }

    let telefone = existing.telefone;
    if (body.telefone !== undefined) {
      telefone = normalizePhone(body.telefone);
      if (telefone) {
        const conflict = await prisma.cliente.findFirst({
          where: { cervejariaId: user.cervejariaId, telefone, NOT: { id } },
        });
        if (conflict) {
          return reply.status(409).send({ error: 'Telefone já usado por outro cliente', clienteId: conflict.id });
        }
      }
    }

    const now = new Date();
    const optInMarketing = body.optInMarketing ?? existing.optInMarketing;

    const nomeNovo = body.nome?.trim();
    const { cliente, comandasAtualizadas } = await prisma.$transaction(async (tx) => {
      // A comanda criada pela tela "Nova comanda" usa o nome do cliente como
      // identificador. Igualdade com o nome anterior distingue esse rótulo de
      // apelidos personalizados; mesa, ficha e comandas fechadas ficam fora.
      const candidatas = nomeNovo && nomeNovo !== existing.nome
        ? await tx.comanda.findMany({
            where: {
              origem: 'CAIXA',
              clienteId: id,
              status: 'ABERTA',
              tipo: 'APELIDO',
              identificador: existing.nome,
              pontoVenda: { cervejariaId: user.cervejariaId },
            },
            select: { id: true },
          })
        : [];

      const clienteAtualizado = await tx.cliente.update({
        where: { id },
        data: {
          ...(body.nome !== undefined ? { nome: body.nome.trim() } : {}),
          ...(body.telefone !== undefined ? { telefone } : {}),
          ...(isDono && body.email !== undefined ? { email: body.email?.trim() || null } : {}),
          ...(isDono && body.dataNascimento !== undefined
            ? { dataNascimento: body.dataNascimento ? new Date(body.dataNascimento) : null }
            : {}),
          ...(isDono && body.observacoes !== undefined ? { observacoes: body.observacoes?.trim() || null } : {}),
          ...(isDono && body.ativo !== undefined ? { ativo: body.ativo } : {}),
          ...(isDono && body.optInMarketing !== undefined
            ? {
                optInMarketing,
                optInEm: optInMarketing ? now : null,
              }
            : {}),
        },
        include: clienteInclude,
      });

      const idsAtualizados: string[] = [];
      for (const candidata of candidatas) {
        const resultado = await tx.comanda.updateMany({
          where: {
            id: candidata.id,
            origem: 'CAIXA',
            clienteId: id,
            status: 'ABERTA',
            tipo: 'APELIDO',
            identificador: existing.nome,
            pontoVenda: { cervejariaId: user.cervejariaId },
          },
          data: { identificador: nomeNovo },
        });
        if (resultado.count > 0) idsAtualizados.push(candidata.id);
      }
      return { cliente: clienteAtualizado, comandasAtualizadas: idsAtualizados };
    });

    for (const comandaId of comandasAtualizadas) {
      notificarComandaOperacaoAtualizada(app, user.cervejariaId!, comandaId);
    }

    return serializeClienteWithExclusao(cliente);
  });

  app.post('/:id/unir', { preHandler: [requireDonoAtual(app)] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };
    const body = z.object({ fonteId: z.string().min(1) }).parse(request.body);

    try {
      const result = await mergeClientes({
        cervejariaId: user.cervejariaId!,
        destinoId: id,
        fonteId: body.fonteId,
      });

      const cliente = await prisma.cliente.findFirstOrThrow({
        where: { id, cervejariaId: user.cervejariaId },
        include: clienteInclude,
      });

      return {
        ...(await serializeClienteWithExclusao(cliente)),
        comandasMovidas: result.comandasMovidas,
        pedidosMovidos: result.pedidosMovidos,
      };
    } catch (err) {
      if (err instanceof ClienteMergeError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.delete('/:id', { preHandler: [requireDonoAtual(app)] }, async (request, reply) => {
    const user = getTenantUser(app, request);
    const { id } = request.params as { id: string };

    const blockReason = await assertClientePodeExcluir(id, user.cervejariaId!);
    if (blockReason === 'Cliente não encontrado') {
      return reply.status(404).send({ error: blockReason });
    }
    if (blockReason) {
      return reply.status(409).send({ error: blockReason });
    }

    await prisma.cliente.delete({ where: { id } });
    return reply.status(204).send();
  });

  app.post('/find-or-create', async (request, reply) => {
    const user = getTenantUser(app, request);
    const body = createClienteSchema.parse(request.body);

    let cliente;
    try {
      cliente = await resolveClienteParaComanda({
        cervejariaId: user.cervejariaId!,
        nome: body.nome,
        telefone: body.telefone,
        cadastradoVia: 'STAFF',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Telefone inválido';
      return reply.status(400).send({ error: message });
    }

    const full = await prisma.cliente.findUniqueOrThrow({
      where: { id: cliente.id },
      include: clienteInclude,
    });
    return serializeClienteWithExclusao(full);
  });
}
