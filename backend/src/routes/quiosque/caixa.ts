import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAuthUser } from '../../types/auth.js';
import {
  abrirCaixa,
  buscarSessaoAtual,
  fecharCaixa,
  montarResumoCaixa,
  registrarMovimento,
} from '../../lib/quiosque/caixa.js';

const pontoVendaQuery = z.object({
  pontoVendaId: z.string().min(1),
});

const abrirSchema = z.object({
  pontoVendaId: z.string().min(1),
  trocoInicial: z.number().min(0),
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
  app.get('/', async (request) => {
    const { cervejariaId } = request.quiosque;
    const { pontoVendaId } = pontoVendaQuery.parse(request.query);

    const sessao = await buscarSessaoAtual(cervejariaId, pontoVendaId);
    if (!sessao) return { sessao: null };

    return { sessao: await montarResumoCaixa(sessao, cervejariaId) };
  });

  app.post('/abrir', async (request, reply) => {
    const { cervejariaId } = request.quiosque;
    const user = getAuthUser(request);
    const body = abrirSchema.parse(request.body);

    const sessao = await abrirCaixa({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      trocoInicial: body.trocoInicial,
      abertoPorId: user.sub,
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
    return reply.status(201).send(sessao);
  });

  app.post('/fechar', async (request) => {
    const { cervejariaId } = request.quiosque;
    const user = getAuthUser(request);
    const body = fecharSchema.parse(request.body);

    return fecharCaixa({
      cervejariaId,
      pontoVendaId: body.pontoVendaId,
      contadoDinheiro: body.contadoDinheiro,
      contadoPix: body.contadoPix,
      contadoCartaoDebito: body.contadoCartaoDebito,
      contadoCartaoCredito: body.contadoCartaoCredito,
      observacaoFechamento: body.observacaoFechamento,
      fechadoPorId: user.sub,
    });
  });
}
