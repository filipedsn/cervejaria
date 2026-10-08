import type { FastifyInstance } from 'fastify';
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
  fecharCaixa,
  montarResumoCaixa,
  registrarMovimento,
} from '../../lib/operacao/caixa.js';
import { getCardapioTurno, salvarCardapioTurno, alterarPrecoCardapioTurno } from '../../lib/operacao/sessao-cardapio.js';
import { getProdutoIdsFromCardapioOperacao, validateProdutosCardapioOperacao } from '../../lib/operacao/cardapio.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import { recordDivergenciaCaixa } from '../../lib/business-metrics.js';
import { centavos } from '../../lib/operacao/venda.js';
import { diaOperacional } from '../../lib/operacao/venda.js';
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
import { requirePermissao, usuarioPode } from '../../lib/operacao/permissoes.js';

const pontoVendaQuery = z.object({
  pontoVendaId: z.string().min(1),
});

const tapTurnoQuery = z.object({
  pontoVendaId: z.string().min(1),
});

const abrirSchema = z
  .object({
    pontoVendaId: z.string().min(1),
    trailerId: z.string().min(1).optional(),
    trocoInicial: z.number().min(0),
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
  valor: z.number().positive(),
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
  contadoDinheiro: z.number().min(0),
  contadoPix: z.number().min(0),
  contadoCartaoDebito: z.number().min(0),
  contadoCartaoCredito: z.number().min(0),
  observacaoFechamento: z.string().trim().max(500).optional(),
});

const corrigirMovimentoSchema = z.object({
  pontoVendaId: z.string().min(1),
  movimentoId: z.string().min(1),
  valorCorrigido: z.number().positive(),
  motivo: z.string().trim().min(1, 'Informe o motivo da correção').max(500),
  autorizadorEmail: z.string().trim().email(),
  autorizadorSenha: z.string().min(1),
});

export async function caixaOperacaoRoutes(app: FastifyInstance) {
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

  app.get('/', async (request, reply) => {
    const { cervejariaId } = request.operacao;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);

    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: pontoVendaId, cervejariaId, ativo: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Ponto de venda não encontrado' });

    const podeVerValores = await usuarioPode(getAuthUser(request), 'cash.values.read');
    const comandasAbertas = await contarComandasAbertas(cervejariaId, pontoVendaId);
    const sessao = await buscarSessaoAtual(cervejariaId, pontoVendaId);
    if (!sessao) return { sessao: null, comandasAbertas, diaOperacional: diaOperacional().toISOString().slice(0, 10) };

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
        diaOperacional: sessao.diaOperacional.toISOString().slice(0, 10),
        valoresRestritos: true,
      };
    }

    const resumo = await montarResumoCaixa(sessao, cervejariaId);
    if (!sessao.ocorrenciaId || !cashOccurrenceContextEnabled()) return { sessao: resumo, comandasAbertas, diaOperacional: sessao.diaOperacional.toISOString().slice(0, 10) };
    return {
      sessao: { ...resumo, ocorrencia: ocorrenciaResumo },
      comandasAbertas,
      diaOperacional: diaOperacional().toISOString().slice(0, 10),
    };
  });

  app.get('/taps', async (request, reply) => {
    const { cervejariaId, tapsEnabled } = request.operacao;
    if (!tapsEnabled) return reply.status(404).send({ error: 'Submódulo de Tap/Chope desativado' });
    const { pontoVendaId } = tapTurnoQuery.parse(request.query);
    const sessao = await prisma.sessaoCaixaOperacao.findFirst({
      where: { cervejariaId, pontoVendaId, status: 'ABERTO' },
      select: { id: true, trailerId: true },
      orderBy: { abertoEm: 'desc' },
    });
    if (!sessao) return reply.status(404).send({ error: 'Abra o caixa antes de configurar os Taps' });
    if (canonicalPdvQaActivationEnabled()) {
      if (await hasUnmappedCanonicalTaps(cervejariaId)) return reply.status(409).send({ error: 'Existem Taps sem mapeamento confirmado para um PDV', code: 'CANONICAL_TAP_MAPPING_REQUIRED' });
      await inicializarMontagemPdv(sessao.id, pontoVendaId, cervejariaId);
      return { pontoVendaId, taps: await listTapsComChopeAtualPdv(sessao.id, pontoVendaId, cervejariaId) };
    }
    const trailerId = await resolverTrailerSessao(sessao, cervejariaId);
    if (!trailerId) return { trailerId: null, taps: [] };

    await inicializarMontagemSessaoCaixa(sessao.id, trailerId);
    return {
      trailerId,
      taps: await listTapsComChopeAtualSessaoCaixa(sessao.id, trailerId),
    };
  });

  app.put('/taps/:tapId/chope', { preHandler: [requirePermissao(app, 'taps.operate')] }, async (request, reply) => {
    const { cervejariaId, tapsEnabled } = request.operacao;
    if (!tapsEnabled) return reply.status(404).send({ error: 'Submódulo de Tap/Chope desativado' });
    const { tapId } = request.params as { tapId: string };
    const body = z.object({ pontoVendaId: z.string().min(1), produtoId: z.string().min(1) }).parse(request.body);
    const sessao = await prisma.sessaoCaixaOperacao.findFirst({
      where: { cervejariaId, pontoVendaId: body.pontoVendaId, status: 'ABERTO' },
      select: { id: true, trailerId: true },
      orderBy: { abertoEm: 'desc' },
    });
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
    const sessao = await prisma.sessaoCaixaOperacao.findFirst({
      where: { cervejariaId, pontoVendaId: body.pontoVendaId, status: 'ABERTO' },
      select: { id: true, trailerId: true },
      orderBy: { abertoEm: 'desc' },
    });
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
    return cardapio;
  });

  app.put('/cardapio', { preHandler: [requirePermissao(app, 'catalog.manage')] }, async (request, reply) => {
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
    return cardapio;
  });

  app.patch('/cardapio/preco', { preHandler: [requirePermissao(app, 'catalog.manage')] }, async (request, reply) => {
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
    return cardapio;
  });
}
