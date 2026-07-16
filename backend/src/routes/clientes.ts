import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import { resolveClienteParaComanda } from '../lib/cliente-resolver.js';
import { normalizePhone, formatPhoneBr } from '../lib/phone.js';
import { toNumber } from '../lib/utils.js';
import { assertClientePodeExcluir, buildExclusaoMeta, getComandaCountsByClienteIds, getClienteComandaCounts } from '../lib/cliente-delete.js';
import { ClienteMergeError, mergeClientes } from '../lib/cliente-merge.js';

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
) {
  return {
    ...cliente,
    telefone: cliente.telefone ? formatPhoneBr(cliente.telefone) : null,
    totalGasto: cliente.estatisticas ? toNumber(cliente.estatisticas.totalGasto) : 0,
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

async function serializeClienteWithExclusao(
  cliente: Prisma.ClienteGetPayload<{ include: typeof clienteInclude }>,
) {
  const counts = await getClienteComandaCounts(cliente.id);
  return serializeCliente(cliente, buildExclusaoMeta(cliente.isSistema, counts));
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

  app.get('/', async (request) => {
    const user = getAuthUser(request);
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

    const countsByCliente = await getComandaCountsByClienteIds(items.map((c) => c.id));

    return {
      items: items.map((cliente) => {
        const counts = countsByCliente.get(cliente.id) ?? { abertas: 0, fechadas: 0 };
        return serializeCliente(cliente, buildExclusaoMeta(cliente.isSistema, counts));
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  });

  app.get('/:id/historico', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const { page, limit } = historicoQuerySchema.parse(request.query);
    const skip = (page - 1) * limit;

    const cliente = await prisma.cliente.findFirst({
      where: { id, cervejariaId: user.cervejariaId, isSistema: false },
      select: { id: true },
    });
    if (!cliente) return reply.status(404).send({ error: 'Cliente não encontrado' });

    const where = { clienteId: id, status: 'FECHADA' as const, tipo: 'COMANDA' as const };

    const [comandas, total] = await Promise.all([
      prisma.comanda.findMany({
        where,
        include: {
          evento: { select: { id: true, nome: true, local: true, data: true } },
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
        total: toNumber(c.total),
        fechadaEm: c.updatedAt,
        evento: c.evento,
        itens: c.itens.map((i) => ({
          id: i.id,
          produto: i.produto.nome,
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

  app.get('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const cliente = await prisma.cliente.findFirst({
      where: { id, cervejariaId: user.cervejariaId, isSistema: false },
      include: clienteInclude,
    });
    if (!cliente) return reply.status(404).send({ error: 'Cliente não encontrado' });

    return serializeClienteWithExclusao(cliente);
  });

  app.post('/', async (request, reply) => {
    const user = getAuthUser(request);
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

  app.patch('/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = patchClienteSchema.parse(request.body);
    const isDono = user.papel === 'DONO';

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

    const cliente = await prisma.cliente.update({
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

    return serializeClienteWithExclusao(cliente);
  });

  app.post('/:id/unir', { preHandler: [app.requireDono] }, async (request, reply) => {
    const user = getAuthUser(request);
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

  app.delete('/:id', { preHandler: [app.requireDono] }, async (request, reply) => {
    const user = getAuthUser(request);
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
    const user = getAuthUser(request);
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
