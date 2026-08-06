import type { FormaPagamentoQuiosque, Prisma, SessaoCaixaQuiosque } from '@prisma/client';
import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import { centavos, diaOperacional, reais } from './venda.js';

export class CaixaInvalidoError extends Error {
  statusCode = 400;
}

type SessaoCompleta = Prisma.SessaoCaixaQuiosqueGetPayload<{ include: { movimentos: true } }>;

const FORMAS: FormaPagamentoQuiosque[] = [
  'DINHEIRO',
  'PIX',
  'CARTAO_DEBITO',
  'CARTAO_CREDITO',
];

function somaCentavos(valores: number[]): number {
  return valores.reduce((soma, valor) => soma + valor, 0);
}

async function pagamentosDoDia(cervejariaId: string, pontoVendaId: string, dia: Date) {
  return prisma.pagamentoQuiosque.findMany({
    where: {
      comanda: {
        cervejariaId,
        pontoVendaId,
        diaOperacional: dia,
        status: 'FECHADA',
      },
    },
    select: { forma: true, valor: true },
  });
}

function totaisPorForma(pagamentos: Array<{ forma: FormaPagamentoQuiosque; valor: unknown }>) {
  const centavosPorForma: Record<FormaPagamentoQuiosque, number> = {
    DINHEIRO: 0,
    PIX: 0,
    CARTAO_DEBITO: 0,
    CARTAO_CREDITO: 0,
  };

  for (const pagamento of pagamentos) {
    centavosPorForma[pagamento.forma] += centavos(pagamento.valor);
  }

  return {
    dinheiro: reais(centavosPorForma.DINHEIRO),
    pix: reais(centavosPorForma.PIX),
    cartaoDebito: reais(centavosPorForma.CARTAO_DEBITO),
    cartaoCredito: reais(centavosPorForma.CARTAO_CREDITO),
    totalVendas: reais(somaCentavos(Object.values(centavosPorForma))),
  };
}

function totaisMovimentos(movimentos: SessaoCompleta['movimentos']) {
  let sangrias = 0;
  let suprimentos = 0;

  for (const movimento of movimentos) {
    const valor = centavos(movimento.valor);
    if (movimento.tipo === 'SANGRIA') sangrias += valor;
    else suprimentos += valor;
  }

  return { sangrias: reais(sangrias), suprimentos: reais(suprimentos) };
}

export async function buscarSessaoAtual(
  cervejariaId: string,
  pontoVendaId: string,
  dia = diaOperacional(),
) {
  return prisma.sessaoCaixaQuiosque.findUnique({
    where: { pontoVendaId_diaOperacional: { pontoVendaId, diaOperacional: dia } },
    include: { movimentos: { orderBy: { createdAt: 'asc' } } },
  });
}

/** Venda so entra no caixa do dia com sessao aberta no mesmo ponto. */
export async function assertCaixaAberto(
  cervejariaId: string,
  pontoVendaId: string,
  dia = diaOperacional(),
) {
  const sessao = await buscarSessaoAtual(cervejariaId, pontoVendaId, dia);
  if (!sessao || sessao.status !== 'ABERTO') {
    throw new CaixaInvalidoError('Abra o caixa do dia antes de registrar vendas');
  }
  return sessao;
}

export async function montarResumoCaixa(
  sessao: SessaoCompleta,
  cervejariaId: string,
) {
  const pagamentos = await pagamentosDoDia(cervejariaId, sessao.pontoVendaId, sessao.diaOperacional);
  const esperado = totaisPorForma(pagamentos);
  const { sangrias, suprimentos } = totaisMovimentos(sessao.movimentos);
  const trocoInicial = toNumber(sessao.trocoInicial);
  const esperadoDinheiro = reais(
    centavos(trocoInicial) + centavos(esperado.dinheiro) + centavos(suprimentos) - centavos(sangrias),
  );

  const contado =
    sessao.contadoDinheiro === null
      ? null
      : {
          dinheiro: toNumber(sessao.contadoDinheiro),
          pix: sessao.contadoPix === null ? 0 : toNumber(sessao.contadoPix),
          cartaoDebito:
            sessao.contadoCartaoDebito === null ? 0 : toNumber(sessao.contadoCartaoDebito),
          cartaoCredito:
            sessao.contadoCartaoCredito === null ? 0 : toNumber(sessao.contadoCartaoCredito),
        };

  const diferencas =
    contado === null
      ? null
      : {
          dinheiro: reais(centavos(contado.dinheiro) - centavos(esperadoDinheiro)),
          pix: reais(centavos(contado.pix) - centavos(esperado.pix)),
          cartaoDebito: reais(centavos(contado.cartaoDebito) - centavos(esperado.cartaoDebito)),
          cartaoCredito: reais(
            centavos(contado.cartaoCredito) - centavos(esperado.cartaoCredito),
          ),
        };

  return {
    id: sessao.id,
    pontoVendaId: sessao.pontoVendaId,
    diaOperacional: sessao.diaOperacional,
    status: sessao.status,
    trocoInicial,
    abertoPorId: sessao.abertoPorId,
    abertoEm: sessao.abertoEm,
    fechadoPorId: sessao.fechadoPorId,
    fechadoEm: sessao.fechadoEm,
    observacaoFechamento: sessao.observacaoFechamento,
    gaveta: {
      trocoInicial,
      entradasDinheiro: esperado.dinheiro,
      suprimentos,
      sangrias,
      esperadoDinheiro,
    },
    esperado,
    contado,
    diferencas,
    movimentos: sessao.movimentos.map((movimento) => ({
      id: movimento.id,
      tipo: movimento.tipo,
      valor: toNumber(movimento.valor),
      observacao: movimento.observacao,
      registradoPorId: movimento.registradoPorId,
      createdAt: movimento.createdAt,
    })),
  };
}

export async function abrirCaixa(params: {
  cervejariaId: string;
  pontoVendaId: string;
  trocoInicial: number;
  abertoPorId: string;
}) {
  if (params.trocoInicial < 0) {
    throw new CaixaInvalidoError('O troco inicial não pode ser negativo');
  }

  const pontoVenda = await prisma.pontoVenda.findFirst({
    where: { id: params.pontoVendaId, cervejariaId: params.cervejariaId, ativo: true },
  });
  if (!pontoVenda) throw new CaixaInvalidoError('Ponto de venda não encontrado');

  const dia = diaOperacional();
  const existente = await buscarSessaoAtual(params.cervejariaId, params.pontoVendaId, dia);
  if (existente) {
    throw new CaixaInvalidoError(
      existente.status === 'ABERTO'
        ? 'O caixa deste ponto já está aberto hoje'
        : 'O caixa deste ponto já foi fechado hoje',
    );
  }

  const sessao = await prisma.sessaoCaixaQuiosque.create({
    data: {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      diaOperacional: dia,
      trocoInicial: params.trocoInicial,
      abertoPorId: params.abertoPorId,
    },
    include: { movimentos: true },
  });

  return montarResumoCaixa(sessao, params.cervejariaId);
}

export async function registrarMovimento(params: {
  cervejariaId: string;
  pontoVendaId: string;
  tipo: 'SANGRIA' | 'SUPRIMENTO';
  valor: number;
  observacao?: string;
  registradoPorId: string;
}) {
  if (params.valor <= 0) throw new CaixaInvalidoError('Informe um valor maior que zero');

  const sessao = await assertCaixaAberto(params.cervejariaId, params.pontoVendaId);

  await prisma.movimentoCaixaQuiosque.create({
    data: {
      sessaoId: sessao.id,
      tipo: params.tipo,
      valor: params.valor,
      observacao: params.observacao,
      registradoPorId: params.registradoPorId,
    },
  });

  const atualizada = await buscarSessaoAtual(params.cervejariaId, params.pontoVendaId);
  if (!atualizada) throw new CaixaInvalidoError('Sessão de caixa não encontrada');

  return montarResumoCaixa(atualizada, params.cervejariaId);
}

export async function fecharCaixa(params: {
  cervejariaId: string;
  pontoVendaId: string;
  contadoDinheiro: number;
  contadoPix: number;
  contadoCartaoDebito: number;
  contadoCartaoCredito: number;
  observacaoFechamento?: string;
  fechadoPorId: string;
}) {
  for (const forma of FORMAS) {
    const campo =
      forma === 'DINHEIRO'
        ? params.contadoDinheiro
        : forma === 'PIX'
          ? params.contadoPix
          : forma === 'CARTAO_DEBITO'
            ? params.contadoCartaoDebito
            : params.contadoCartaoCredito;
    if (campo < 0) throw new CaixaInvalidoError('Valores contados não podem ser negativos');
  }

  const sessao = await assertCaixaAberto(params.cervejariaId, params.pontoVendaId);

  const fechada = await prisma.sessaoCaixaQuiosque.update({
    where: { id: sessao.id },
    data: {
      status: 'FECHADO',
      fechadoPorId: params.fechadoPorId,
      fechadoEm: new Date(),
      contadoDinheiro: params.contadoDinheiro,
      contadoPix: params.contadoPix,
      contadoCartaoDebito: params.contadoCartaoDebito,
      contadoCartaoCredito: params.contadoCartaoCredito,
      observacaoFechamento: params.observacaoFechamento,
    },
    include: { movimentos: { orderBy: { createdAt: 'asc' } } },
  });

  return montarResumoCaixa(fechada, params.cervejariaId);
}
