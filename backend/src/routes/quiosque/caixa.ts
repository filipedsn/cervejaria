import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getAuthUser } from '../../types/auth.js';
import {
  abrirCaixa,
  buscarRelatorioTurnoFechado,
  buscarSessaoAtual,
  CaixaInvalidoError,
  contarComandasAbertas,
  fecharCaixa,
  montarResumoCaixa,
  registrarMovimento,
} from '../../lib/quiosque/caixa.js';
import { getCardapioTurno, salvarCardapioTurno, alterarPrecoCardapioTurno } from '../../lib/quiosque/sessao-cardapio.js';
import { getProdutoIdsFromCardapioQuiosque, validateProdutosCardapioQuiosque } from '../../lib/quiosque/cardapio.js';
import { registrarTransacao } from '../../lib/transacao-log.js';
import { recordDivergenciaCaixa } from '../../lib/business-metrics.js';
import { centavos } from '../../lib/quiosque/venda.js';

const pontoVendaQuery = z.object({
  pontoVendaId: z.string().min(1),
});

const abrirSchema = z
  .object({
    pontoVendaId: z.string().min(1),
    trocoInicial: z.number().min(0),
    cardapioId: z.string().optional(),
    produtoIds: z.array(z.string().min(1)).optional(),
  })
  .refine((data) => !(data.cardapioId && data.produtoIds?.length), {
    message: 'Escolha um cardápio salvo ou monte na hora, não os dois',
  });

const movimentoSchema = z.object({
  pontoVendaId: z.string().min(1),
  tipo: z.enum(['SANGRIA', 'SUPRIMENTO']),
  valor: z.number().positive(),
  observacao: z.string().trim().max(280).optional(),
});

const fecharSchema = z.object({
  pontoVendaId: z.string().min(1),
  contadoDinheiro: z.number().min(0),
  contadoPix: z.number().min(0),
  contadoCartaoDebito: z.number().min(0),
  contadoCartaoCredito: z.number().min(0),
  observacaoFechamento: z.string().trim().max(500).optional(),
});

export async function caixaQuiosqueRoutes(app: FastifyInstance) {
  app.get('/sessoes/:sessaoId', { preHandler: [app.requireDono] }, async (request, reply) => {
    const { cervejariaId } = request.quiosque;
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
    const { cervejariaId } = request.quiosque;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);

    const pontoVenda = await prisma.pontoVenda.findFirst({
      where: { id: pontoVendaId, cervejariaId, ativo: true },
    });
    if (!pontoVenda) return reply.status(404).send({ error: 'Ponto de venda não encontrado' });

    const comandasAbertas = await contarComandasAbertas(cervejariaId, pontoVendaId);
    const sessao = await buscarSessaoAtual(cervejariaId, pontoVendaId);
    if (!sessao) return { sessao: null, comandasAbertas };

    return {
      sessao: await montarResumoCaixa(sessao, cervejariaId),
      comandasAbertas,
    };
  });

  app.post('/abrir', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const user = getAuthUser(request);
    const body = abrirSchema.parse(request.body);

    if (body.cardapioId) {
      const check = await getProdutoIdsFromCardapioQuiosque(body.cardapioId, cervejariaId);
      if ('error' in check) return reply.status(400).send({ error: check.error });
    }
    if (body.produtoIds?.length) {
      const check = await validateProdutosCardapioQuiosque(cervejariaId, body.produtoIds);
      if ('error' in check) return reply.status(400).send({ error: check.error });
    }

    const sessao = await abrirCaixa({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      trocoInicial: body.trocoInicial,
      abertoPorId: user.sub,
      cardapioId: body.cardapioId,
      produtoIds: body.produtoIds,
    });
    void registrarTransacao({
      cervejariaId,
      tipo: 'QUIOSQUE_CAIXA_ABERTO',
      usuarioId: user.sub,
      entidadeId: sessao.id,
      metadata: { pontoVendaId: body.pontoVendaId, trocoInicial: body.trocoInicial },
      payload: sessao,
    });
    return reply.status(201).send(sessao);
  });

  app.post('/movimentos', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
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
      tipo: 'QUIOSQUE_CAIXA_MOVIMENTO',
      usuarioId: user.sub,
      metadata: { tipo: body.tipo, valor: body.valor, pontoVendaId: body.pontoVendaId, observacao: body.observacao },
      payload: sessao,
    });
    return reply.status(201).send(sessao);
  });

  app.post('/fechar', async (request) => {
    const { cervejariaId } = request.quiosque;
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
      tipo: 'QUIOSQUE_CAIXA_FECHADO',
      usuarioId: user.sub,
      metadata: { pontoVendaId: body.pontoVendaId, divergenciaCentavos: divCent },
      payload: resumo,
    });
    return resumo;
  });

  app.get('/cardapio', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);

    const sessao = await buscarSessaoAtual(cervejariaId, pontoVendaId);
    if (!sessao) return reply.status(404).send({ error: 'Caixa não está aberto' });

    const cardapio = await getCardapioTurno(sessao.id, cervejariaId);
    if (!cardapio) return reply.status(404).send({ error: 'Turno não encontrado' });
    return cardapio;
  });

  app.put('/cardapio', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
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

  app.patch('/cardapio/preco', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);
    const body = z
      .object({
        produtoId: z.string().min(1),
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
