import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import {
  abrirCaixa,
  buscarRelatorioTurnoFechado,
  buscarSessaoAtual,
  CaixaInvalidoError,
  corrigirMovimento,
  contarComandasAbertas,
  contarPedidosCozinhaPendentes,
  assertSemPedidosCozinhaPendentes,
  fecharCaixa,
  montarResumoCaixa,
  registrarMovimento,
  escopoComandasDoTurno,
} from '../../lib/operacao/caixa.js';
import { getCardapioTurno, salvarCardapioTurno, alterarPrecoCardapioTurno } from '../../lib/operacao/sessao-cardapio.js';
import { getProdutoIdsFromCardapioOperacao, validateProdutosCardapioOperacao } from '../../lib/operacao/cardapio.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import { recordDivergenciaCaixa } from '../../lib/business-metrics.js';
import { centavos } from '../../lib/operacao/venda.js';
import { diaOperacional } from '../../lib/operacao/venda.js';
import { resumoComanda } from '../../lib/operacao/venda.js';
import { INCLUDE_COMANDA_OPERACAO, whereComandaOperacao } from '../../lib/operacao/comanda-adapter.js';
import { resolveUniqueOpenCashSession } from '../../lib/operacao/cash-session-resolution.js';
import {
  inicializarMontagemSessaoCaixa,
  inicializarMontagemPdv,
  hasUnmappedCanonicalTaps,
  listTapsComChopeAtualSessaoCaixa,
  listTapsComChopeAtualPdv,
  posicionarChopeNoTurno,
  posicionarChopeNoPdv,
  removerChopeDoTurno,
  removerChopeDoPdv,
} from '../../lib/tap-montagem.js';
import { canonicalPdvQaActivationEnabled } from '../../lib/canonical-pdv-operational-config.js';
import { cashOccurrenceContextEnabled } from '../../lib/operacao/contexto-ocorrencia.js';
import { requireDonoAtual, requirePermissao, requirePermissaoPrecoCardapioTurno, usuarioPode } from '../../lib/operacao/permissoes.js';

const pontoVendaQuery = z.object({
  pontoVendaId: z.string().min(1),
});

const tapTurnoQuery = z.object({
  pontoVendaId: z.string().min(1),
  sessaoCaixaId: z.string().min(1).optional(),
});

const abrirSchema = z
  .object({
    pontoVendaId: z.string().min(1),
    trailerId: z.string().min(1).optional(),
    trocoInicial: z.number({ invalid_type_error: 'Informe o troco inicial', required_error: 'Informe o troco inicial' }).min(0, 'O troco inicial não pode ser negativo'),
    cardapioId: z.string().optional(),
    produtoIds: z.array(z.string().min(1)).optional(),
    ocorrenciaId: z.string().min(1).optional(),
    confirmarDataDiferente: z.boolean().optional(),
  })
  .refine((data) => !(data.cardapioId && data.produtoIds !== undefined), {
    message: 'Escolha um cardápio salvo ou monte na hora, não os dois',
  })
  .refine((data) => Boolean(data.cardapioId) || Boolean(data.produtoIds?.length), {
    message: 'Escolha um cardápio salvo ou monte o cardápio antes de abrir o caixa',
  });

const movimentoSchema = z.object({
  pontoVendaId: z.string().min(1),
  tipo: z.enum(['SANGRIA', 'SUPRIMENTO']),
  valor: z.number({ invalid_type_error: 'Informe o valor', required_error: 'Informe o valor' }).positive('O valor da movimentação deve ser maior que zero'),
  observacao: z.string().trim().max(280).optional(),
});

/** Corrige sessões antigas abertas sem trailer somente quando há um único trailer ativo. */
async function resolverTrailerSessao(sessao: { id: string; trailerId: string | null }, cervejariaId: string) {
  if (sessao.trailerId) return sessao.trailerId;

  const trailers = await prisma.trailer.findMany({
    where: { cervejariaId, ativo: true },
    select: { id: true },
    take: 2,
  });
  if (trailers.length !== 1) return null;

  const trailerId = trailers[0]!.id;
  const vinculada = await prisma.sessaoCaixaOperacao.updateMany({
    where: { id: sessao.id, cervejariaId, status: 'ABERTO', trailerId: null },
    data: { trailerId },
  });
  if (vinculada.count === 1) return trailerId;

  const atual = await prisma.sessaoCaixaOperacao.findFirst({
    where: { id: sessao.id, cervejariaId, status: 'ABERTO' },
    select: { trailerId: true },
  });
  return atual?.trailerId ?? null;
}

const fecharSchema = z.object({
  pontoVendaId: z.string().min(1),
  contadoDinheiro: z.number({ required_error: 'Informe o valor contado em dinheiro' }).min(0, 'O valor contado em dinheiro não pode ser negativo'),
  contadoPix: z.number({ required_error: 'Informe o valor contado em Pix' }).min(0, 'O valor contado em Pix não pode ser negativo'),
  contadoCartaoDebito: z.number({ required_error: 'Informe o valor contado em cartão de débito' }).min(0, 'O valor contado em cartão de débito não pode ser negativo'),
  contadoCartaoCredito: z.number({ required_error: 'Informe o valor contado em cartão de crédito' }).min(0, 'O valor contado em cartão de crédito não pode ser negativo'),
  observacaoFechamento: z.string().trim().max(500).optional(),
  /** Instantâneo real do encerramento operacional (ISO). Omitido = agora. */
  fechadoEm: z.string().datetime({ offset: true }).optional(),
});

const encerramentoAdministrativoSchema = z.object({
  motivo: z.string().trim().min(8, 'Informe um motivo com pelo menos 8 caracteres').max(500),
});

const corrigirMovimentoSchema = z.object({
  pontoVendaId: z.string().min(1),
  movimentoId: z.string().min(1),
  valorCorrigido: z.number({ required_error: 'Informe o valor corrigido' }).positive('O valor corrigido deve ser maior que zero'),
  motivo: z.string().trim().min(1, 'Informe o motivo da correção').max(500),
  autorizadorEmail: z.string().trim().email(),
  autorizadorSenha: z.string().min(1),
});

export async function caixaOperacaoRoutes(app: FastifyInstance) {
  const incluirPermissoesEdicaoCardapio = async (
    request: FastifyRequest,
    cardapio: NonNullable<Awaited<ReturnType<typeof getCardapioTurno>>>,
  ) => {
    const user = getAuthUser(request);
    const [cardapioTurno, precoTemplate] = await Promise.all([
      usuarioPode(user, 'catalog.shift.manage'),
      usuarioPode(user, 'catalog.manage'),
    ]);
    return {
      ...cardapio,
      permissoesEdicao: { cardapioTurno, precoTurno: cardapioTurno, precoTemplate },
    };
  };

  app.post('/sessoes/:sessaoId/encerramento-administrativo', {
    preHandler: [requireDonoAtual(app)],
  }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { sessaoId } = request.params as { sessaoId: string };
    const { motivo } = encerramentoAdministrativoSchema.parse(request.body);
    const operadorId = getAuthUser(request).sub;
    const resultado = await prisma.$transaction(async (tx) => {
      const sessao = await tx.sessaoCaixaOperacao.findFirst({
        where: { id: sessaoId, cervejariaId },
        select: { id: true, pontoVendaId: true, status: true, tipoEncerramento: true },
      });
      if (!sessao) return { erro: 'Sessão não encontrada', status: 404 as const };
      if (sessao.status === 'FECHADO') {
        if (sessao.tipoEncerramento === 'ADMINISTRATIVO') {
          return { sessaoId, idempotente: true };
        }
        return { erro: 'A sessão já foi encerrada financeiramente ou não possui classificação administrativa', status: 409 as const };
      }

      try {
        await assertSemPedidosCozinhaPendentes(cervejariaId, sessao.pontoVendaId, tx);
      } catch (err) {
        if (err instanceof CaixaInvalidoError) {
          return { erro: err.message, status: (err.statusCode ?? 409) as 409 };
        }
        throw err;
      }

      const fechadoEm = new Date();
      const atualizada = await tx.sessaoCaixaOperacao.updateMany({
        where: { id: sessao.id, cervejariaId, status: 'ABERTO' },
        data: {
          status: 'FECHADO',
          tipoEncerramento: 'ADMINISTRATIVO',
          fechadoPorId: operadorId,
          fechadoEm,
          observacaoFechamento: motivo,
        },
      });
      if (atualizada.count !== 1) {
        const estado = await tx.sessaoCaixaOperacao.findFirst({
          where: { id: sessao.id, cervejariaId },
          select: { status: true, tipoEncerramento: true },
        });
        if (estado?.status === 'FECHADO' && estado.tipoEncerramento === 'ADMINISTRATIVO') {
          return { sessaoId, idempotente: true };
        }
        return { erro: 'A sessão mudou durante o encerramento; recarregue e tente novamente', status: 409 as const };
      }

      const auditoria = await registrarTransacao({
        cervejariaId,
        tipo: 'CASH_REGISTER_ADMINISTRATIVE_CLOSED',
        usuarioId: operadorId,
        entidadeTipo: 'SessaoCaixaOperacao',
        entidadeId: sessao.id,
        metadata: {
          modoEncerramento: 'ADMINISTRATIVO',
          sessaoCaixaId: sessao.id,
          pontoVendaId: sessao.pontoVendaId,
          motivo,
          operadorId,
          fechadoEm: fechadoEm.toISOString(),
          conferênciaFinanceira: 'PENDENTE',
          contagensPreservadasComoDesconhecidas: true,
          pagamentosAlterados: false,
          movimentosGerados: false,
        },
      }, tx);
      if (!auditoria) throw new Error('Não foi possível persistir a auditoria do encerramento administrativo');
      return { sessaoId, idempotente: false };
    });
    if ('erro' in resultado && typeof resultado.status === 'number') {
      return reply.status(resultado.status).send({ error: resultado.erro });
    }
    return resultado;
  });

  app.get('/sessoes/:sessaoId', { preHandler: [requirePermissao(app, 'cash.values.read')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { sessaoId } = request.params as { sessaoId: string };

    try {
      return await buscarRelatorioTurnoFechado(sessaoId, cervejariaId);
    } catch (err) {
      if (err instanceof CaixaInvalidoError) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get('/sessoes/:sessaoId/comandas', { preHandler: [requirePermissao(app, 'command.read')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { sessaoId } = request.params as { sessaoId: string };
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(25),
      tipo: z.enum(['TODOS', 'COMANDAS', 'AVULSAS', 'CANCELADAS']).default('TODOS'),
    }).parse(request.query);
    const sessao = await prisma.sessaoCaixaOperacao.findFirst({
      where: { id: sessaoId, cervejariaId, status: 'FECHADO', fechadoEm: { not: null } },
      select: { id: true, cervejariaId: true, pontoVendaId: true, diaOperacional: true, abertoEm: true, fechadoEm: true, tipoEncerramento: true },
    });
    if (!sessao?.fechadoEm) return reply.status(404).send({ error: 'Turno não encontrado' });

    const escopoTurno = escopoComandasDoTurno({ ...sessao, fechadoEm: sessao.fechadoEm });
    const whereVendas = whereComandaOperacao(cervejariaId, {
      pontoVendaId: sessao.pontoVendaId,
      status: 'FECHADA',
      AND: [escopoTurno],
    });
    const whereCanceladas = whereComandaOperacao(cervejariaId, {
      pontoVendaId: sessao.pontoVendaId,
      status: 'CANCELADA',
      sessaoCaixaRealizacaoId: sessao.id,
    });
    const whereTodos = { OR: [whereVendas, whereCanceladas] };
    const filteredWhere = query.tipo === 'CANCELADAS'
      ? whereCanceladas
      : query.tipo === 'AVULSAS'
        ? { AND: [whereVendas, { tipo: 'AVULSA' as const }] }
        : query.tipo === 'COMANDAS'
          ? { AND: [whereVendas, { tipo: { not: 'AVULSA' as const } }] }
          : whereTodos;
    const [total, totalVendas, totalComandas, totalAvulsas, totalCanceladas, vinculadas, semVinculo, rows] = await Promise.all([
      prisma.comanda.count({ where: filteredWhere }),
      prisma.comanda.count({ where: whereVendas }),
      prisma.comanda.count({ where: { AND: [whereVendas, { tipo: { not: 'AVULSA' } }] } }),
      prisma.comanda.count({ where: { AND: [whereVendas, { tipo: 'AVULSA' }] } }),
      prisma.comanda.count({ where: whereCanceladas }),
      prisma.comanda.count({ where: { AND: [whereTodos, { sessaoCaixaRealizacaoId: sessao.id }] } }),
      prisma.comanda.count({ where: { AND: [whereVendas, { sessaoCaixaRealizacaoId: null }] } }),
      prisma.comanda.findMany({
        where: filteredWhere,
        include: INCLUDE_COMANDA_OPERACAO,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const from = total === 0 ? 0 : (query.page - 1) * query.pageSize + 1;

    return {
      dados: rows.map((comanda) => ({
        ...resumoComanda(comanda, request.operacao.effectiveSettings.kitchenItemsChargeAtLaunch),
        vinculoSessao: comanda.sessaoCaixaRealizacaoId === sessao.id ? 'CONFIRMADO' as const : 'NAO_COMPROVADO' as const,
      })),
      filtroAtivo: query.tipo,
      escopo: {
        totalRegistros: totalVendas + totalCanceladas,
        registrosDeVenda: totalVendas,
        comandas: totalComandas,
        vendasAvulsas: totalAvulsas,
        comandasCanceladas: totalCanceladas,
        vinculoConfirmado: vinculadas,
        semVinculoConfiavel: semVinculo,
        criterio: sessao.tipoEncerramento === 'ADMINISTRATIVO'
          ? 'Vínculo explícito ao turno, empresa e PDV; canceladas só entram com vínculo explícito.'
          : 'Vínculo explícito ao turno; para vendas históricas sem vínculo, mesma empresa, PDV, origem CAIXA, dia operacional e fechamento dentro da janela do turno. Essas vendas continuam identificadas como sem vínculo confiável. Comandas canceladas só entram com vínculo explícito.',
      },
      paginacao: { pagina: query.page, tamanhoPagina: query.pageSize, totalFiltrado: total, paginas: totalPages, de: from, ate: Math.min(query.page * query.pageSize, total) },
    };
  });

  app.get('/sessoes/:sessaoId/recebimentos-anteriores', { preHandler: [requirePermissao(app, 'cash.values.read')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { sessaoId } = request.params as { sessaoId: string };
    const sessao = await prisma.sessaoCaixaOperacao.findFirst({
      where: { id: sessaoId, cervejariaId, status: 'FECHADO', fechadoEm: { not: null } },
      select: { id: true, cervejariaId: true, pontoVendaId: true, diaOperacional: true, abertoEm: true, fechadoEm: true, tipoEncerramento: true },
    });
    if (!sessao?.fechadoEm) return reply.status(404).send({ error: 'Turno não encontrado' });

    const recebimentos = await prisma.pagamento.findMany({
      where: {
        sessaoCaixaId: sessao.id,
        contaReceberId: { not: null },
        comanda: { origem: 'CAIXA', status: 'FECHADA', pontoVendaId: sessao.pontoVendaId, pontoVenda: { cervejariaId } },
      },
      include: {
        comanda: { select: { id: true, tipo: true, numero: true, identificador: true, cliente: { select: { id: true, nome: true } }, sessaoCaixaRealizacaoId: true, diaOperacional: true, fechadaEm: true, total: true } },
      },
      orderBy: [{ pagoEm: 'asc' }, { id: 'asc' }],
    });
    const vendasNoTurno = await prisma.comanda.findMany({
      where: whereComandaOperacao(cervejariaId, { pontoVendaId: sessao.pontoVendaId, status: 'FECHADA', AND: [escopoComandasDoTurno({ ...sessao, fechadoEm: sessao.fechadoEm })] }),
      select: { id: true },
    });
    const vendaIds = new Set(vendasNoTurno.map((comanda) => comanda.id));
    const anteriores = recebimentos.filter((pagamento) => !vendaIds.has(pagamento.comandaId));
    const porComanda = new Map<string, (typeof anteriores)>();
    for (const pagamento of anteriores) {
      const grupo = porComanda.get(pagamento.comandaId) ?? [];
      grupo.push(pagamento);
      porComanda.set(pagamento.comandaId, grupo);
    }

    return [...porComanda.values()].map((pagamentos) => {
      const comanda = pagamentos[0]!.comanda;
      return {
        comanda: {
          id: comanda.id,
          tipo: comanda.tipo,
          numero: comanda.numero,
          identificador: comanda.identificador,
          cliente: comanda.cliente,
          sessaoOrigemId: comanda.sessaoCaixaRealizacaoId,
          fechadaEm: comanda.fechadaEm,
          total: Number(comanda.total),
        },
        pagamentos: pagamentos.map((pagamento) => ({ id: pagamento.id, forma: pagamento.forma, valor: Number(pagamento.valor), pagoEm: pagamento.pagoEm })),
        recebidoNesteTurno: pagamentos.reduce((soma, pagamento) => soma + Number(pagamento.valor), 0),
      };
    });
  });

  app.get('/', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);

    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: pontoVendaId, cervejariaId, ativo: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Ponto de venda não encontrado' });

    const podeVerValores = await usuarioPode(getAuthUser(request), 'cash.values.read');
    const [comandasAbertas, pedidosCozinhaPendentes] = await Promise.all([
      contarComandasAbertas(cervejariaId, pontoVendaId),
      contarPedidosCozinhaPendentes(cervejariaId, pontoVendaId),
    ]);
    const sessao = await buscarSessaoAtual(cervejariaId, pontoVendaId);
    if (!sessao) {
      return {
        sessao: null,
        comandasAbertas,
        pedidosCozinhaPendentes,
        diaOperacional: diaOperacional().toISOString().slice(0, 10),
      };
    }

    const ocorrencia = sessao.ocorrenciaId
      ? await prisma.ocorrenciaOperacional.findFirst({
          where: { id: sessao.ocorrenciaId, cervejariaId, pontoVendaId },
          select: { id: true, nome: true, data: true, status: true, agenda: { select: { nome: true, frequencia: true, diaSemana: true } } },
        })
      : null;
    const ocorrenciaResumo = ocorrencia ? { ...ocorrencia, data: ocorrencia.data.toISOString().slice(0, 10) } : null;

    if (!podeVerValores) {
      return {
        sessao: {
          id: sessao.id,
          status: sessao.status,
          pontoVendaId: sessao.pontoVendaId,
          abertoEm: sessao.abertoEm,
          fechadoEm: sessao.fechadoEm,
          ocorrenciaId: sessao.ocorrenciaId,
          ocorrencia: ocorrenciaResumo,
          diaOperacional: sessao.diaOperacional.toISOString().slice(0, 10),
        },
        comandasAbertas,
        pedidosCozinhaPendentes,
        diaOperacional: sessao.diaOperacional.toISOString().slice(0, 10),
        valoresRestritos: true,
      };
    }

    const resumo = await montarResumoCaixa(sessao, cervejariaId);
    if (!sessao.ocorrenciaId || !cashOccurrenceContextEnabled()) {
      return {
        sessao: resumo,
        comandasAbertas,
        pedidosCozinhaPendentes,
        diaOperacional: sessao.diaOperacional.toISOString().slice(0, 10),
      };
    }
    return {
      sessao: { ...resumo, ocorrencia: ocorrenciaResumo },
      comandasAbertas,
      pedidosCozinhaPendentes,
      diaOperacional: sessao.diaOperacional.toISOString().slice(0, 10),
    };
  });

  app.get('/taps', async (request, reply) => {
    const { cervejariaId, tapsEnabled } = request.operacao;
    if (!tapsEnabled) return reply.status(404).send({ error: 'Submódulo de Tap/Chope desativado' });
    const { pontoVendaId, sessaoCaixaId } = tapTurnoQuery.parse(request.query);
    const sessoes = await prisma.sessaoCaixaOperacao.findMany({
      where: { cervejariaId, pontoVendaId, status: 'ABERTO' },
      select: { id: true, trailerId: true },
      orderBy: { abertoEm: 'asc' },
      take: 2,
    });
    const sessao = resolveUniqueOpenCashSession(sessoes);
    if (!sessao) return reply.status(404).send({ error: 'Abra o caixa antes de configurar os Taps' });
    if (sessaoCaixaId && sessao.id !== sessaoCaixaId) {
      return reply.status(409).send({ error: 'O turno mudou. Atualize a seleção de Tap e tente novamente.', code: 'CASH_SESSION_CHANGED' });
    }
    if (canonicalPdvQaActivationEnabled()) {
      if (await hasUnmappedCanonicalTaps(cervejariaId)) return reply.status(409).send({ error: 'Existem Taps sem mapeamento confirmado para um PDV', code: 'CANONICAL_TAP_MAPPING_REQUIRED' });
      await inicializarMontagemPdv(sessao.id, pontoVendaId, cervejariaId);
      return { pontoVendaId, sessaoCaixaId: sessao.id, taps: await listTapsComChopeAtualPdv(sessao.id, pontoVendaId, cervejariaId) };
    }
    const trailerId = await resolverTrailerSessao(sessao, cervejariaId);
    if (!trailerId) return { pontoVendaId, sessaoCaixaId: sessao.id, trailerId: null, taps: [] };

    await inicializarMontagemSessaoCaixa(sessao.id, trailerId);
    return {
      pontoVendaId,
      sessaoCaixaId: sessao.id,
      trailerId,
      taps: await listTapsComChopeAtualSessaoCaixa(sessao.id, trailerId),
    };
  });

  app.put('/taps/:tapId/chope', { preHandler: [requirePermissao(app, 'taps.operate')] }, async (request, reply) => {
    const { cervejariaId, tapsEnabled } = request.operacao;
    if (!tapsEnabled) return reply.status(404).send({ error: 'Submódulo de Tap/Chope desativado' });
    const { tapId } = request.params as { tapId: string };
    const body = z.object({ pontoVendaId: z.string().min(1), produtoId: z.string().min(1) }).parse(request.body);
    const sessoes = await prisma.sessaoCaixaOperacao.findMany({
      where: { cervejariaId, pontoVendaId: body.pontoVendaId, status: 'ABERTO' },
      select: { id: true, trailerId: true },
      orderBy: { abertoEm: 'asc' },
      take: 2,
    });
    const sessao = resolveUniqueOpenCashSession(sessoes);
    if (!sessao) return reply.status(400).send({ error: 'O caixa não possui trailer vinculado' });
    if (canonicalPdvQaActivationEnabled()) {
      if (await hasUnmappedCanonicalTaps(cervejariaId)) return reply.status(409).send({ error: 'Existem Taps sem mapeamento confirmado para um PDV', code: 'CANONICAL_TAP_MAPPING_REQUIRED' });
      const result = await posicionarChopeNoPdv({ sessaoCaixaId: sessao.id, pontoVendaId: body.pontoVendaId, tapId, produtoId: body.produtoId, cervejariaId });
      if ('error' in result) return reply.status(400).send({ error: result.error });
      return { pontoVendaId: body.pontoVendaId, taps: await listTapsComChopeAtualPdv(sessao.id, body.pontoVendaId, cervejariaId), message: 'Montagem atualizada'};
    }
    const trailerId = await resolverTrailerSessao(sessao, cervejariaId);
    if (!trailerId) return reply.status(400).send({ error: 'Trailer required' });
    const result = await posicionarChopeNoTurno({
      sessaoCaixaId: sessao.id,
      trailerId,
      tapId,
      produtoId: body.produtoId,
      cervejariaId,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });
    return {
      trailerId,
      taps: await listTapsComChopeAtualSessaoCaixa(sessao.id, trailerId),
      message: `Tap ${result.tapNumero}: ${result.chopeAnterior ?? 'vazio'} → ${result.chopeNovo}`,
    };
  });

  app.delete('/taps/:tapId/chope', { preHandler: [requirePermissao(app, 'taps.operate')] }, async (request, reply) => {
    const { cervejariaId, tapsEnabled } = request.operacao;
    if (!tapsEnabled) return reply.status(404).send({ error: 'Submódulo de Tap/Chope desativado' });
    const { tapId } = request.params as { tapId: string };
    const body = z.object({ pontoVendaId: z.string().min(1) }).parse(request.body);
    const sessoes = await prisma.sessaoCaixaOperacao.findMany({
      where: { cervejariaId, pontoVendaId: body.pontoVendaId, status: 'ABERTO' },
      select: { id: true, trailerId: true },
      orderBy: { abertoEm: 'asc' },
      take: 2,
    });
    const sessao = resolveUniqueOpenCashSession(sessoes);
    if (!sessao) return reply.status(400).send({ error: 'O caixa não possui trailer vinculado' });
    if (canonicalPdvQaActivationEnabled()) {
      if (await hasUnmappedCanonicalTaps(cervejariaId)) return reply.status(409).send({ error: 'Existem Taps sem mapeamento confirmado para um PDV', code: 'CANONICAL_TAP_MAPPING_REQUIRED' });
      const result = await removerChopeDoPdv({ sessaoCaixaId: sessao.id, pontoVendaId: body.pontoVendaId, tapId, cervejariaId });
      if ('error' in result) return reply.status(400).send({ error: result.error });
      return { pontoVendaId: body.pontoVendaId, taps: await listTapsComChopeAtualPdv(sessao.id, body.pontoVendaId, cervejariaId) };
    }
    const trailerId = await resolverTrailerSessao(sessao, cervejariaId);
    if (!trailerId) return reply.status(400).send({ error: 'Trailer required' });
    const result = await removerChopeDoTurno({
      sessaoCaixaId: sessao.id,
      trailerId,
      tapId,
      cervejariaId,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });
    return {
      trailerId,
      taps: await listTapsComChopeAtualSessaoCaixa(sessao.id, trailerId),
    };
  });

  app.post('/abrir', { preHandler: [requirePermissao(app, 'cash.open')] }, async (request, reply) => {
    const { cervejariaId, tapsEnabled } = request.operacao;
    const user = getAuthUser(request);
    const body = abrirSchema.parse(request.body);

    if (body.cardapioId) {
      const check = await getProdutoIdsFromCardapioOperacao(body.cardapioId, cervejariaId);
      if ('error' in check) return reply.status(400).send({ error: check.error });
    }
    if (body.produtoIds?.length) {
      const check = await validateProdutosCardapioOperacao(cervejariaId, body.produtoIds);
      if ('error' in check) return reply.status(400).send({ error: check.error });
    }

    const sessao = await abrirCaixa({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      trailerId: body.trailerId,
      tapsEnabled,
      trocoInicial: body.trocoInicial,
      abertoPorId: user.sub,
      cardapioId: body.cardapioId,
      produtoIds: body.produtoIds,
      ocorrenciaId: body.ocorrenciaId,
      confirmarDataDiferente: body.confirmarDataDiferente,
    });
    void registrarTransacao({
      cervejariaId,
      tipo: 'CASH_REGISTER_OPENED',
      usuarioId: user.sub,
      entidadeId: sessao.id,
      metadata: { pontoVendaId: body.pontoVendaId, trocoInicial: body.trocoInicial, ocorrenciaId: sessao.ocorrenciaId ?? null },
      payload: sessao,
    });
    if (!(await usuarioPode(user, 'cash.values.read'))) {
      return reply.status(201).send({ id: sessao.id, pontoVendaId: body.pontoVendaId, status: sessao.status, abertoEm: sessao.abertoEm, valoresRestritos: true });
    }
    return reply.status(201).send(sessao);
  });

  app.post('/movimentos', { preHandler: [requirePermissao(app, 'cash.movement.write')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const body = movimentoSchema.parse(request.body);

    const sessao = await registrarMovimento({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      tipo: body.tipo,
      valor: body.valor,
      observacao: body.observacao,
      registradoPorId: user.sub,
    });
    void registrarTransacao({
      cervejariaId,
      tipo: 'CASH_MOVEMENT_RECORDED',
      usuarioId: user.sub,
      metadata: { tipo: body.tipo, valor: body.valor, pontoVendaId: body.pontoVendaId, observacao: body.observacao },
      payload: sessao,
    });
    if (!(await usuarioPode(user, 'cash.values.read'))) {
      return reply.status(201).send({ id: sessao.id, pontoVendaId: body.pontoVendaId, status: sessao.status, abertoEm: sessao.abertoEm, valoresRestritos: true });
    }
    return reply.status(201).send(sessao);
  });

  app.post('/movimentos/:movimentoId/corrigir', { preHandler: [requirePermissao(app, ['cash.movement.write', 'cash.values.read'])] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const body = corrigirMovimentoSchema
      .extend({ movimentoId: z.string().min(1) })
      .parse({ ...(request.body as object), movimentoId: (request.params as { movimentoId: string }).movimentoId });

    const resumo = await corrigirMovimento({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      movimentoId: body.movimentoId,
      valorCorrigido: body.valorCorrigido,
      motivo: body.motivo,
      solicitanteId: user.sub,
      autorizadorEmail: body.autorizadorEmail,
      autorizadorSenha: body.autorizadorSenha,
    });
    const original = resumo.movimentos.find((movimento) => movimento.id === body.movimentoId);
    // Credencial e senha nunca fazem parte do payload de transacao/auditoria.
    void registrarTransacao({
      cervejariaId,
      tipo: 'CASH_MOVEMENT_CORRECTED',
      usuarioId: user.sub,
      entidadeTipo: 'MovimentoCaixaOperacao',
      entidadeId: body.movimentoId,
      metadata: {
        sessaoCaixaId: resumo.id,
        pontoVendaId: body.pontoVendaId,
        movimentoOriginalId: body.movimentoId,
        tipo: original?.tipo,
        valorOriginal: original?.valor,
        valorCorrigido: body.valorCorrigido,
        motivo: body.motivo,
        solicitanteId: user.sub,
        autorizadorId: original?.autorizadoPorId,
      },
    });
    return reply.status(201).send(resumo);
  });

  app.post('/fechar', { preHandler: [requirePermissao(app, ['cash.close', 'cash.values.read'])] }, async (request) => {
    const { cervejariaId } = request.operacao;
    const user = getAuthUser(request);
    const body = fecharSchema.parse(request.body);

    const resumo = await fecharCaixa({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      contadoDinheiro: body.contadoDinheiro,
      contadoPix: body.contadoPix,
      contadoCartaoDebito: body.contadoCartaoDebito,
      contadoCartaoCredito: body.contadoCartaoCredito,
      observacaoFechamento: body.observacaoFechamento,
      fechadoEm: body.fechadoEm ? new Date(body.fechadoEm) : undefined,
      fechadoPorId: user.sub,
    });
    const dif = resumo.diferencas;
    const divCent = dif
      ? Math.abs(centavos(dif.dinheiro)) +
        Math.abs(centavos(dif.pix)) +
        Math.abs(centavos(dif.cartaoDebito)) +
        Math.abs(centavos(dif.cartaoCredito))
      : 0;
    if (divCent > 0) recordDivergenciaCaixa(divCent);
    void registrarTransacao({
      cervejariaId,
      tipo: 'CASH_REGISTER_CLOSED',
      usuarioId: user.sub,
      metadata: { pontoVendaId: body.pontoVendaId, divergenciaCentavos: divCent },
      payload: resumo,
    });
    return resumo;
  });

  app.get('/cardapio', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);

    const sessao = await buscarSessaoAtual(cervejariaId, pontoVendaId);
    if (!sessao) return reply.status(404).send({ error: 'Caixa não está aberto' });

    const cardapio = await getCardapioTurno(sessao.id, cervejariaId);
    if (!cardapio) return reply.status(404).send({ error: 'Turno não encontrado' });
    return incluirPermissoesEdicaoCardapio(request, cardapio);
  });

  app.put('/cardapio', { preHandler: [requirePermissao(app, 'catalog.shift.manage')] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);
    const body = z
      .object({
        cardapioId: z.string().optional(),
        produtoIds: z.array(z.string().min(1)).optional(),
      })
      .refine((data) => !(data.cardapioId && data.produtoIds !== undefined), {
        message: 'Escolha um cardápio salvo ou monte na hora, não os dois',
      })
      .parse(request.body);

    const sessao = await buscarSessaoAtual(cervejariaId, pontoVendaId);
    if (!sessao) return reply.status(404).send({ error: 'Caixa não está aberto' });

    const result = await salvarCardapioTurno({
      sessaoCaixaId: sessao.id,
      cervejariaId,
      cardapioId: body.cardapioId,
      produtoIds: body.produtoIds,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });

    const cardapio = await getCardapioTurno(sessao.id, cervejariaId);
    if (!cardapio) return reply.status(404).send({ error: 'Turno não encontrado' });
    return incluirPermissoesEdicaoCardapio(request, cardapio);
  });

  app.patch('/cardapio/preco', { preHandler: [requirePermissaoPrecoCardapioTurno(app)] }, async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);
    const body = z
      .object({
        produtoId: z.string().min(1),
        volumeMl: z.number().int().nonnegative().optional(),
        precoUnit: z.number().positive(),
        escopo: z.enum(['TURNO', 'TEMPLATE']),
      })
      .parse(request.body);

    const sessao = await buscarSessaoAtual(cervejariaId, pontoVendaId);
    if (!sessao) return reply.status(404).send({ error: 'Caixa não está aberto' });

    const result = await alterarPrecoCardapioTurno({
      sessaoCaixaId: sessao.id,
      cervejariaId,
      produtoId: body.produtoId,
      volumeMl: body.volumeMl,
      precoUnit: body.precoUnit,
      escopo: body.escopo,
    });
    if ('error' in result) {
      return reply.status(result.statusCode).send({ error: result.error });
    }

    const cardapio = await getCardapioTurno(sessao.id, cervejariaId);
    if (!cardapio) return reply.status(404).send({ error: 'Turno não encontrado' });
    return incluirPermissoesEdicaoCardapio(request, cardapio);
  });
}
