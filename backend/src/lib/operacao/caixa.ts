import { createHash } from 'node:crypto';
import type { PaymentMethod, Prisma, SessaoCaixaQuiosque } from '@prisma/client';
import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import { centavos, diaOperacional, reais } from './venda.js';
import { pedidoContaNaComanda } from './cozinha.js';
import {
  aplicarCardapioCatalogoSeVazio,
  aplicarCardapioInicialTurno,
} from './sessao-cardapio.js';
import { quiosqueUsaCardapio } from '../cardapio-toggle.js';
import { verifyPassword } from '../utils.js';
import { getOperationalProfile } from '../operational-profile.js';

export class CaixaInvalidoError extends Error {
  statusCode = 400;
}

type SessaoCompleta = Prisma.SessaoCaixaQuiosqueGetPayload<{ include: { movimentos: true } }>;

const FORMAS: PaymentMethod[] = [
  'DINHEIRO',
  'PIX',
  'CARTAO_DEBITO',
  'CARTAO_CREDITO',
];

const CAIXA_TX = { maxWait: 15_000, timeout: 20_000 } as const;

/** Compatibility projection for diagnostics; it is not a product guard. */
export function resolveCashRegisterCapability(params: {
  pontoVendaAtivo: boolean;
  operationMode: 'CAIXA' | 'EVENTO';
}): boolean {
  return params.pontoVendaAtivo && params.operationMode === 'CAIXA';
}

type CaixaCapabilityReader = Pick<Prisma.TransactionClient, 'pontoVenda'>;
type OperationalProfileReader = typeof getOperationalProfile;

/** Guards only the unit capability; session and financial rules stay separate. */
export async function assertCashRegisterUnitEnabled(
  cervejariaId: string,
  pontoVendaId: string,
  db: CaixaCapabilityReader = prisma,
  profileReader: OperationalProfileReader = getOperationalProfile,
) {
  const pontoVenda = await db.pontoVenda.findFirst({
    where: { id: pontoVendaId, cervejariaId, ativo: true },
    select: {
      ativo: true,
    },
  });
  if (!pontoVenda) throw new CaixaInvalidoError('Ponto de venda não encontrado');

  const profile = await profileReader(cervejariaId);
  const enabled = resolveCashRegisterCapability({
    pontoVendaAtivo: pontoVenda.ativo,
    operationMode: profile?.operationMode ?? 'EVENTO',
  });
  if (!enabled) throw new CaixaInvalidoError('Caixa não habilitado para este ponto de venda');
}

/** Serializa as mutações de um ponto no mesmo dia operacional. */
function chaveLockCaixa(cervejariaId: string, pontoVendaId: string, dia: Date): bigint {
  const digest = createHash('sha256')
    .update(`caixa-quiosque:${cervejariaId}:${pontoVendaId}:${dia.toISOString().slice(0, 10)}`)
    .digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

export async function lockCaixaEmTx(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  cervejariaId: string,
  pontoVendaId: string,
  dia: Date,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${chaveLockCaixa(cervejariaId, pontoVendaId, dia)})`;
}

function somaCentavos(valores: number[]): number {
  return valores.reduce((soma, valor) => soma + valor, 0);
}

/** Dinheiro esperado na gaveta: troco inicial + vendas em espécie + suprimentos − sangrias. */
export function calcularEsperadoDinheiroGaveta(params: {
  trocoInicial: number;
  entradasDinheiro: number;
  suprimentos: number;
  sangrias: number;
}): number {
  return reais(
    centavos(params.trocoInicial) +
      centavos(params.entradasDinheiro) +
      centavos(params.suprimentos) -
      centavos(params.sangrias),
  );
}

export function totaisPorForma(pagamentos: Array<{ forma: PaymentMethod; valor: unknown }>) {
  const centavosPorForma: Record<'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO', number> = {
    DINHEIRO: 0,
    PIX: 0,
    CARTAO_DEBITO: 0,
    CARTAO_CREDITO: 0,
  };

  for (const pagamento of pagamentos) {
    if (pagamento.forma in centavosPorForma) {
      centavosPorForma[pagamento.forma as keyof typeof centavosPorForma] += centavos(pagamento.valor);
    }
  }

  return {
    dinheiro: reais(centavosPorForma.DINHEIRO),
    pix: reais(centavosPorForma.PIX),
    cartaoDebito: reais(centavosPorForma.CARTAO_DEBITO),
    cartaoCredito: reais(centavosPorForma.CARTAO_CREDITO),
    totalVendas: reais(somaCentavos(Object.values(centavosPorForma))),
  };
}

export function totaisMovimentos(movimentos: Array<{ tipo: 'SANGRIA' | 'SUPRIMENTO'; valor: unknown }>) {
  let sangrias = 0;
  let suprimentos = 0;

  for (const movimento of movimentos) {
    const valor = centavos(movimento.valor);
    if (movimento.tipo === 'SANGRIA') sangrias += valor;
    else suprimentos += valor;
  }

  return { sangrias: reais(sangrias), suprimentos: reais(suprimentos) };
}

/** As duas pernas imutaveis que anulam o lancamento errado e registram o valor correto. */
export function planoCorrecaoMovimento(params: {
  tipo: 'SANGRIA' | 'SUPRIMENTO';
  valorOriginal: number;
  valorCorrigido: number;
}) {
  if (params.valorOriginal <= 0 || params.valorCorrigido <= 0) {
    throw new CaixaInvalidoError('Informe um valor corrigido maior que zero');
  }
  return {
    estorno: {
      tipo: params.tipo === 'SANGRIA' ? 'SUPRIMENTO' : 'SANGRIA',
      valor: params.valorOriginal,
    } as const,
    substituicao: { tipo: params.tipo, valor: params.valorCorrigido } as const,
  };
}

async function pagamentosDaSessao(sessao: SessaoCompleta, cervejariaId: string) {
  const fechadaAte =
    sessao.status === 'FECHADO' && sessao.fechadoEm ? sessao.fechadoEm : undefined;

  return prisma.pagamento.findMany({
    where: {
      comanda: {
        origem: 'QUIOSQUE',
        pontoVenda: { cervejariaId },
        pontoVendaId: sessao.pontoVendaId,
        diaOperacional: sessao.diaOperacional,
        status: 'FECHADA',
        fechadaEm: {
          gte: sessao.abertoEm,
          ...(fechadaAte ? { lte: fechadaAte } : {}),
        },
      },
    },
    select: { forma: true, valor: true },
  });
}

export async function contarComandasAbertas(
  cervejariaId: string,
  pontoVendaId: string,
  db: Pick<Prisma.TransactionClient, 'comanda'> = prisma,
) {
  return db.comanda.count({
    where: {
      origem: 'QUIOSQUE',
      pontoVenda: { cervejariaId },
      pontoVendaId,
      status: 'ABERTA',
      tipo: { not: 'AVULSA' },
    },
  });
}

export async function assertSemComandasAbertas(
  cervejariaId: string,
  pontoVendaId: string,
  db: Pick<Prisma.TransactionClient, 'comanda'> = prisma,
) {
  const abertas = await contarComandasAbertas(cervejariaId, pontoVendaId, db);
  if (abertas > 0) {
    const rotulo = abertas === 1 ? '1 comanda aberta' : `${abertas} comandas abertas`;
    throw new CaixaInvalidoError(
      `Não é possível fechar o caixa: há ${rotulo}. Feche ou cancele todas antes de encerrar o turno.`,
    );
  }
}

export async function buscarSessaoAtual(
  cervejariaId: string,
  pontoVendaId: string,
  dia = diaOperacional(),
) {
  return prisma.sessaoCaixaQuiosque.findFirst({
    where: { cervejariaId, pontoVendaId, diaOperacional: dia, status: 'ABERTO' },
    include: { movimentos: { orderBy: { createdAt: 'asc' } } },
    orderBy: { abertoEm: 'desc' },
  });
}

/** Venda so entra no caixa do dia com sessao aberta no mesmo ponto. */
export async function assertCaixaAberto(
  cervejariaId: string,
  pontoVendaId: string,
  dia = diaOperacional(),
  db: Pick<Prisma.TransactionClient, 'sessaoCaixaQuiosque' | 'pontoVenda'> = prisma,
  profileReader: OperationalProfileReader = getOperationalProfile,
) {
  await assertCashRegisterUnitEnabled(cervejariaId, pontoVendaId, db, profileReader);
  const sessao = await db.sessaoCaixaQuiosque.findFirst({
    where: { cervejariaId, pontoVendaId, diaOperacional: dia, status: 'ABERTO' },
    include: { movimentos: { orderBy: { createdAt: 'asc' } } },
    orderBy: { abertoEm: 'desc' },
  });
  if (!sessao || sessao.status !== 'ABERTO') {
    throw new CaixaInvalidoError('Abra o caixa do dia antes de registrar vendas');
  }
  return sessao;
}

export async function montarResumoCaixa(
  sessao: SessaoCompleta,
  cervejariaId: string,
) {
  const pagamentos = await pagamentosDaSessao(sessao, cervejariaId);
  const esperado = totaisPorForma(pagamentos);
  const { sangrias, suprimentos } = totaisMovimentos(sessao.movimentos);
  const trocoInicial = toNumber(sessao.trocoInicial);
  const esperadoDinheiro = calcularEsperadoDinheiroGaveta({
    trocoInicial,
    entradasDinheiro: esperado.dinheiro,
    suprimentos,
    sangrias,
  });

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
      correcaoDeId: movimento.correcaoDeId,
      naturezaCorrecao: movimento.naturezaCorrecao,
      motivoCorrecao: movimento.motivoCorrecao,
      autorizadoPorId: movimento.autorizadoPorId,
      solicitadoPorId: movimento.solicitadoPorId,
      corrigidoEm: movimento.corrigidoEm,
      createdAt: movimento.createdAt,
    })),
  };
}

export async function abrirCaixa(params: {
  cervejariaId: string;
  pontoVendaId: string;
  trocoInicial: number;
  abertoPorId: string;
  cardapioId?: string;
  produtoIds?: string[];
}) {
  if (params.trocoInicial < 0) {
    throw new CaixaInvalidoError('O troco inicial não pode ser negativo');
  }

  await assertCashRegisterUnitEnabled(params.cervejariaId, params.pontoVendaId);

  const dia = diaOperacional();
  const aberta = await buscarSessaoAtual(params.cervejariaId, params.pontoVendaId, dia);
  if (aberta) {
    throw new CaixaInvalidoError('O caixa deste ponto já está aberto');
  }

  const usaCardapio = await quiosqueUsaCardapio(params.cervejariaId);
  const cardapioId = usaCardapio ? params.cardapioId : undefined;
  const produtoIds = usaCardapio ? params.produtoIds : undefined;

  const sessao = await prisma.$transaction(async (tx) => {
    await lockCaixaEmTx(tx, params.cervejariaId, params.pontoVendaId, dia);
    const abertaAgora = await tx.sessaoCaixaQuiosque.findFirst({
      where: {
        cervejariaId: params.cervejariaId,
        pontoVendaId: params.pontoVendaId,
        diaOperacional: dia,
        status: 'ABERTO',
      },
      select: { id: true },
    });
    if (abertaAgora) throw new CaixaInvalidoError('O caixa deste ponto já está aberto');

    return tx.sessaoCaixaQuiosque.create({
      data: {
        cervejariaId: params.cervejariaId,
        pontoVendaId: params.pontoVendaId,
        diaOperacional: dia,
        trocoInicial: params.trocoInicial,
        abertoPorId: params.abertoPorId,
        cardapioQuiosqueId: cardapioId ?? null,
      },
      include: { movimentos: true },
    });
  }, CAIXA_TX);

  await aplicarCardapioInicialTurno({
    sessaoCaixaId: sessao.id,
    cervejariaId: params.cervejariaId,
    cardapioId,
    produtoIds,
  });
  await aplicarCardapioCatalogoSeVazio(sessao.id, params.cervejariaId);

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

  const atualizada = await prisma.$transaction(async (tx) => {
    const dia = diaOperacional();
    await lockCaixaEmTx(tx, params.cervejariaId, params.pontoVendaId, dia);
    const sessao = await assertCaixaAberto(params.cervejariaId, params.pontoVendaId, dia, tx);

    await tx.movimentoCaixaQuiosque.create({
      data: {
        sessaoId: sessao.id,
        tipo: params.tipo,
        valor: params.valor,
        observacao: params.observacao,
        registradoPorId: params.registradoPorId,
      },
    });

    return tx.sessaoCaixaQuiosque.findUniqueOrThrow({
      where: { id: sessao.id },
      include: { movimentos: { orderBy: { createdAt: 'asc' } } },
    });
  }, CAIXA_TX);

  return montarResumoCaixa(atualizada, params.cervejariaId);
}

/**
 * Corrige exclusivamente movimentos manuais do turno aberto. O valor original
 * e imutavel: criamos um estorno e uma substituicao no mesmo lock do caixa.
 */
export async function corrigirMovimento(params: {
  cervejariaId: string;
  pontoVendaId: string;
  movimentoId: string;
  valorCorrigido: number;
  motivo: string;
  solicitanteId: string;
  autorizadorEmail: string;
  autorizadorSenha: string;
}) {
  if (params.valorCorrigido <= 0) throw new CaixaInvalidoError('Informe um valor corrigido maior que zero');
  if (!params.motivo.trim()) throw new CaixaInvalidoError('Informe o motivo da correção');

  const atualizada = await prisma.$transaction(async (tx) => {
    const dia = diaOperacional();
    await lockCaixaEmTx(tx, params.cervejariaId, params.pontoVendaId, dia);
    const sessao = await assertCaixaAberto(params.cervejariaId, params.pontoVendaId, dia, tx);

    const autorizador = await tx.usuario.findFirst({
      where: {
        email: params.autorizadorEmail.trim().toLowerCase(),
        papel: 'DONO',
        cervejariaId: params.cervejariaId,
      },
      select: { id: true, senhaHash: true },
    });
    if (!autorizador || !(await verifyPassword(params.autorizadorSenha, autorizador.senhaHash))) {
      throw new CaixaInvalidoError('Credencial do proprietário inválida');
    }

    const original = await tx.movimentoCaixaQuiosque.findFirst({
      where: {
        id: params.movimentoId,
        sessaoId: sessao.id,
        correcaoDeId: null,
        naturezaCorrecao: null,
        corrigidoEm: null,
      },
    });
    if (!original) {
      throw new CaixaInvalidoError('Movimento não elegível para correção ou já corrigido');
    }

    const plano = planoCorrecaoMovimento({
      tipo: original.tipo,
      valorOriginal: toNumber(original.valor),
      valorCorrigido: params.valorCorrigido,
    });
    const agora = new Date();
    const comum = {
      sessaoId: sessao.id,
      correcaoDeId: original.id,
      motivoCorrecao: params.motivo.trim(),
      autorizadoPorId: autorizador.id,
      solicitadoPorId: params.solicitanteId,
      registradoPorId: params.solicitanteId,
    };

    await tx.movimentoCaixaQuiosque.update({
      where: { id: original.id },
      data: {
        corrigidoEm: agora,
        motivoCorrecao: params.motivo.trim(),
        autorizadoPorId: autorizador.id,
        solicitadoPorId: params.solicitanteId,
      },
    });
    await tx.movimentoCaixaQuiosque.create({
      data: { ...comum, ...plano.estorno, naturezaCorrecao: 'ESTORNO' },
    });
    await tx.movimentoCaixaQuiosque.create({
      data: { ...comum, ...plano.substituicao, naturezaCorrecao: 'SUBSTITUICAO' },
    });

    return tx.sessaoCaixaQuiosque.findUniqueOrThrow({
      where: { id: sessao.id },
      include: { movimentos: { orderBy: { createdAt: 'asc' } } },
    });
  }, CAIXA_TX);

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

  const fechada = await prisma.$transaction(async (tx) => {
    const dia = diaOperacional();
    await lockCaixaEmTx(tx, params.cervejariaId, params.pontoVendaId, dia);
    const sessao = await assertCaixaAberto(params.cervejariaId, params.pontoVendaId, dia, tx);
    await assertSemComandasAbertas(params.cervejariaId, params.pontoVendaId, tx);

    return tx.sessaoCaixaQuiosque.update({
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
  }, CAIXA_TX);

  return montarResumoCaixa(fechada, params.cervejariaId);
}

export async function buscarRelatorioTurnoFechado(sessaoId: string, cervejariaId: string) {
  const sessao = await prisma.sessaoCaixaQuiosque.findFirst({
    where: { id: sessaoId, cervejariaId, status: 'FECHADO' },
    include: { movimentos: true, pontoVenda: { select: { id: true, nome: true } } },
  });
  if (!sessao?.fechadoEm) {
    throw new CaixaInvalidoError('Turno não encontrado');
  }

  const caixa = await montarResumoCaixa(sessao, cervejariaId);
  const pagamentos = await prisma.pagamento.findMany({
    where: {
      comanda: {
        origem: 'QUIOSQUE',
        pontoVenda: { cervejariaId },
        pontoVendaId: sessao.pontoVendaId,
        diaOperacional: sessao.diaOperacional,
        status: 'FECHADA',
        fechadaEm: { gte: sessao.abertoEm, lte: sessao.fechadoEm },
      },
    },
    select: { comandaId: true },
  });
  const comandaIds = new Set(pagamentos.map((pagamento) => pagamento.comandaId));

  const vendasAvulsas = await prisma.comanda.count({
    where: {
      origem: 'QUIOSQUE',
      pontoVenda: { cervejariaId },
      pontoVendaId: sessao.pontoVendaId,
      tipo: 'AVULSA',
      status: 'FECHADA',
      fechadaEm: { gte: sessao.abertoEm, lte: sessao.fechadoEm },
    },
  });

  const duracaoMinutos = Math.max(
    1,
    Math.round((sessao.fechadoEm.getTime() - sessao.abertoEm.getTime()) / 60_000),
  );
  const duracaoHoras = Math.max(0.25, Math.round((duracaoMinutos / 60) * 100) / 100);

  const usuarioIds = [sessao.abertoPorId, sessao.fechadoPorId].filter(Boolean) as string[];
  const usuarios = usuarioIds.length
    ? await prisma.usuario.findMany({
        where: { id: { in: usuarioIds } },
        select: { id: true, nome: true },
      })
    : [];
  const nomeUsuario = (id: string | null) => usuarios.find((usuario) => usuario.id === id)?.nome ?? null;

  const comandas = await prisma.comanda.findMany({
    where: {
      origem: 'QUIOSQUE',
      pontoVenda: { cervejariaId },
      pontoVendaId: sessao.pontoVendaId,
      diaOperacional: sessao.diaOperacional,
      status: 'FECHADA',
      fechadaEm: { gte: sessao.abertoEm, lte: sessao.fechadoEm },
    },
    include: { itens: true },
  });

  const porProduto = new Map<
    string,
    { produtoId: string; nome: string; quantidade: number; receita: number }
  >();
  let itensVendidos = 0;

  for (const comanda of comandas) {
    for (const item of comanda.itens) {
      if (!item.produtoId) continue;
      itensVendidos += item.quantidade;
      const itemValor = toNumber(item.precoUnit) * item.quantidade;
      const prod = porProduto.get(item.produtoId) ?? {
        produtoId: item.produtoId,
        nome: item.nome ?? 'Item',
        quantidade: 0,
        receita: 0,
      };
      prod.quantidade += item.quantidade;
      prod.receita += itemValor;
      porProduto.set(item.produtoId, prod);
    }
  }

  const receitaTotal = caixa.esperado.totalVendas;
  const porProdutoArr = Array.from(porProduto.values())
    .map((produto) => ({
      ...produto,
      receita: Math.round(produto.receita * 100) / 100,
      percentual: receitaTotal > 0 ? Math.round((produto.receita / receitaTotal) * 100) : 0,
    }))
    .sort((a, b) => b.receita - a.receita);

  return {
    caixa,
    pontoNome: sessao.pontoVenda.nome,
    abertoPorNome: nomeUsuario(sessao.abertoPorId) ?? '—',
    fechadoPorNome: nomeUsuario(sessao.fechadoPorId),
    comandasAtendidas: comandaIds.size,
    vendasAvulsas,
    itensVendidos,
    porProduto: porProdutoArr,
    ticketMedio:
      comandaIds.size > 0
        ? Math.round((caixa.esperado.totalVendas / comandaIds.size) * 100) / 100
        : 0,
    duracaoMinutos,
    receitaPorHora:
      duracaoHoras > 0
        ? Math.round((caixa.esperado.totalVendas / duracaoHoras) * 100) / 100
        : 0,
  };
}
