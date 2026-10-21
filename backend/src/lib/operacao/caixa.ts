import type { PaymentMethod, Prisma, SessaoCaixaOperacao } from '@prisma/client';
import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import { itemContaNaVendaLiquida } from '../venda-liquida.js';
import { centavos, diaOperacional, reais } from './venda.js';
import { pedidoContaNaComanda } from './cozinha.js';
import { aplicarCardapioInicialTurno } from './sessao-cardapio.js';
import { verifyPassword } from '../utils.js';
import { getOperationalProfile } from '../operational-profile.js';
import { readCanonicalPdvOperationalSettingsIfEnabled } from '../canonical-pdv-operational-config.js';
import { hasUnmappedCanonicalTaps, inicializarMontagemSessaoCaixa, inicializarMontagemPdv } from '../tap-montagem.js';
import { canonicalPdvQaActivationEnabled } from '../canonical-pdv-operational-config.js';
import { validateCashOccurrenceSelection } from './contexto-ocorrencia.js';
import { lockAgendaResource } from './agenda.js';
import { paymentFilterForOperationalSession } from './payment-session-filter.js';
import { lockCaixaEmTx } from './caixa-lock.js';
import { resolveUniqueOpenCashSession } from './cash-session-resolution.js';
export { lockCaixaEmTx } from './caixa-lock.js';

export class CaixaInvalidoError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

type SessaoCompleta = Prisma.SessaoCaixaOperacaoGetPayload<{ include: { movimentos: true } }>;

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

/** Serializes cash-session mutations for a tenant and point across civil days. */
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

export function totalPendenteContasReceber(
  contas: Array<{ valorOriginal: unknown; pagamentos: Array<{ valor: unknown }> }>,
): number {
  const saldoTotal = contas.reduce((total, conta) => {
    const recebido = conta.pagamentos.reduce((soma, pagamento) => soma + centavos(pagamento.valor), 0);
    return total + Math.max(0, centavos(conta.valorOriginal) - recebido);
  }, 0);
  return reais(saldoTotal);
}

export function resumirFiadoDoTurno(
  contas: Array<{ valorOriginal: unknown; recebimentos: Array<{ valor: unknown; nesteTurno: boolean }> }>,
) {
  let vendido = 0;
  let quitadoNoTurno = 0;
  let quitadoDepois = 0;
  for (const conta of contas) {
    vendido += centavos(conta.valorOriginal);
    for (const recebimento of conta.recebimentos) {
      if (recebimento.nesteTurno) quitadoNoTurno += centavos(recebimento.valor);
      else quitadoDepois += centavos(recebimento.valor);
    }
  }
  return {
    fiadoVendido: reais(vendido),
    fiadoQuitadoNoTurno: reais(quitadoNoTurno),
    fiadoQuitadoDepois: reais(quitadoDepois),
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
  const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId);

  return prisma.pagamento.findMany({
    where: paymentFilterForOperationalSession(sessao, cervejariaId, canonical !== null),
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
      origem: 'CAIXA',
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
  _dia = diaOperacional(),
) {
  const sessoes = await prisma.sessaoCaixaOperacao.findMany({
    where: { cervejariaId, pontoVendaId, status: 'ABERTO' },
    include: { movimentos: { orderBy: { createdAt: 'asc' } } },
    orderBy: { abertoEm: 'asc' },
    take: 2,
  });
  return resolveUniqueOpenCashSession(sessoes);
}

/** Resolves the active session for this tenant and point, regardless of its opening day. */
export async function assertCaixaAberto(
  cervejariaId: string,
  pontoVendaId: string,
  _dia = diaOperacional(),
  db: Pick<Prisma.TransactionClient, 'sessaoCaixaOperacao' | 'pontoVenda'> = prisma,
  profileReader: OperationalProfileReader = getOperationalProfile,
) {
  await assertCashRegisterUnitEnabled(cervejariaId, pontoVendaId, db, profileReader);
  const sessoes = await db.sessaoCaixaOperacao.findMany({
    where: { cervejariaId, pontoVendaId, status: 'ABERTO' },
    include: { movimentos: { orderBy: { createdAt: 'asc' } } },
    orderBy: { abertoEm: 'asc' },
    take: 2,
  });
  const sessao = resolveUniqueOpenCashSession(sessoes);
  if (!sessao || sessao.status !== 'ABERTO') {
    throw new CaixaInvalidoError('Abra o caixa antes de registrar vendas');
  }
  return sessao;
}

export async function montarResumoCaixa(
  sessao: SessaoCompleta,
  cervejariaId: string,
) {
  const [pagamentos, contasPendentes] = await Promise.all([
    pagamentosDaSessao(sessao, cervejariaId),
    prisma.contaReceber.findMany({
      where: {
        comanda: {
          origem: 'CAIXA',
          pontoVendaId: sessao.pontoVendaId,
          pontoVenda: { cervejariaId },
          diaOperacional: sessao.diaOperacional,
          status: 'FECHADA',
          fechadaEm: {
            gte: sessao.abertoEm,
            ...(sessao.status === 'FECHADO' && sessao.fechadoEm ? { lte: sessao.fechadoEm } : {}),
          },
        },
      },
      select: { valorOriginal: true, pagamentos: { select: { valor: true } } },
    }),
  ]);
  const esperado = totaisPorForma(pagamentos);
  const pendente = totalPendenteContasReceber(contasPendentes);
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
    ocorrenciaId: sessao.ocorrenciaId ?? null,
    trailerId: sessao.trailerId,
    diaOperacional: sessao.diaOperacional,
    status: sessao.status,
    trocoInicial,
    abertoPorId: sessao.abertoPorId,
    abertoEm: sessao.abertoEm,
    fechadoPorId: sessao.fechadoPorId,
    fechadoEm: sessao.fechadoEm,
    tipoEncerramento: sessao.tipoEncerramento,
    observacaoFechamento: sessao.observacaoFechamento,
    pendente,
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
  trailerId?: string;
  tapsEnabled?: boolean;
  trocoInicial: number;
  abertoPorId: string;
  cardapioId?: string;
  produtoIds?: string[];
  ocorrenciaId?: string;
  confirmarDataDiferente?: boolean;
}) {
  const escolheuCardapio = Boolean(params.cardapioId);
  const montouCardapio = Boolean(params.produtoIds?.length);
  if (escolheuCardapio === montouCardapio || (escolheuCardapio && params.produtoIds !== undefined)) {
    throw new CaixaInvalidoError('Escolha um cardápio salvo ou monte o cardápio antes de abrir o caixa');
  }

  if (params.trocoInicial < 0) {
    throw new CaixaInvalidoError('O troco inicial não pode ser negativo');
  }

  await assertCashRegisterUnitEnabled(params.cervejariaId, params.pontoVendaId);
  const canonicalPdv = canonicalPdvQaActivationEnabled();
  if (canonicalPdv && params.tapsEnabled && await hasUnmappedCanonicalTaps(params.cervejariaId)) {
    throw new CaixaInvalidoError('Existem Taps sem mapeamento confirmado para um PDV');
  }

  if (params.trailerId && !params.tapsEnabled) {
    throw new CaixaInvalidoError('O submódulo de Tap/Chope está desativado nas configurações');
  }
  const trailersAtivos = params.tapsEnabled && !canonicalPdv
    ? await prisma.trailer.findMany({
        where: { cervejariaId: params.cervejariaId, ativo: true },
        select: { id: true },
        take: 2,
      })
    : [];
  const trailerId = params.tapsEnabled && !canonicalPdv
    ? params.trailerId ?? (trailersAtivos.length === 1 ? trailersAtivos[0]?.id : undefined)
    : undefined;

  if (!canonicalPdv && params.tapsEnabled && trailersAtivos.length > 1 && !trailerId) {
    throw new CaixaInvalidoError('Selecione o trailer que será usado neste turno');
  }

  if (!canonicalPdv && trailerId) {
    const trailer = await prisma.trailer.findFirst({
      where: { id: trailerId, cervejariaId: params.cervejariaId, ativo: true },
      select: { id: true },
    });
    if (!trailer) throw new CaixaInvalidoError('Trailer não encontrado ou inativo');
  }

  const dia = diaOperacional();
  const aberta = await buscarSessaoAtual(params.cervejariaId, params.pontoVendaId);
  if (aberta) {
    throw new CaixaInvalidoError('O caixa deste ponto já está aberto');
  }

  const cardapioId = params.cardapioId;
  const produtoIds = params.produtoIds;

  const sessao = await prisma.$transaction(async (tx) => {
    await lockCaixaEmTx(tx, params.cervejariaId, params.pontoVendaId, dia);
    if (canonicalPdv && params.ocorrenciaId) await lockAgendaResource(tx, params, 'ocorrencia', params.ocorrenciaId);
    const ocorrenciaId = await validateCashOccurrenceSelection(tx, {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      ocorrenciaId: params.ocorrenciaId,
      diaOperacional: dia,
      confirmarDataDiferente: params.confirmarDataDiferente,
    });
    const abertasAgora = await tx.sessaoCaixaOperacao.findMany({
      where: {
        cervejariaId: params.cervejariaId,
        pontoVendaId: params.pontoVendaId,
        status: 'ABERTO',
      },
      select: { id: true },
      take: 2,
    });
    const abertaAgora = resolveUniqueOpenCashSession(abertasAgora);
    if (abertaAgora) throw new CaixaInvalidoError('O caixa deste ponto já está aberto');

    return tx.sessaoCaixaOperacao.create({
      data: {
        cervejariaId: params.cervejariaId,
        pontoVendaId: params.pontoVendaId,
        trailerId: trailerId ?? null,
        diaOperacional: dia,
        trocoInicial: params.trocoInicial,
        abertoPorId: params.abertoPorId,
        cardapioId: cardapioId ?? null,
        ...(ocorrenciaId !== undefined ? { ocorrenciaId } : {}),
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
  if (canonicalPdv && params.tapsEnabled) {
    await inicializarMontagemPdv(sessao.id, params.pontoVendaId, params.cervejariaId);
  } else if (trailerId) {
    await inicializarMontagemSessaoCaixa(sessao.id, trailerId);
  }

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

    await tx.movimentoCaixaOperacao.create({
      data: {
        sessaoId: sessao.id,
        tipo: params.tipo,
        valor: params.valor,
        observacao: params.observacao,
        registradoPorId: params.registradoPorId,
      },
    });

    return tx.sessaoCaixaOperacao.findUniqueOrThrow({
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

    const original = await tx.movimentoCaixaOperacao.findFirst({
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

    await tx.movimentoCaixaOperacao.update({
      where: { id: original.id },
      data: {
        corrigidoEm: agora,
        motivoCorrecao: params.motivo.trim(),
        autorizadoPorId: autorizador.id,
        solicitadoPorId: params.solicitanteId,
      },
    });
    await tx.movimentoCaixaOperacao.create({
      data: { ...comum, ...plano.estorno, naturezaCorrecao: 'ESTORNO' },
    });
    await tx.movimentoCaixaOperacao.create({
      data: { ...comum, ...plano.substituicao, naturezaCorrecao: 'SUBSTITUICAO' },
    });

    return tx.sessaoCaixaOperacao.findUniqueOrThrow({
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

    return tx.sessaoCaixaOperacao.update({
      where: { id: sessao.id },
      data: {
        status: 'FECHADO',
        tipoEncerramento: 'FINANCEIRO',
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

/**
 * Administrative closure has no physical count and no trustworthy time window,
 * so its report only includes comandas explicitly linked to the session.
 */
export function escopoComandasDoTurno(sessao: {
  id: string;
  tipoEncerramento: string | null;
  diaOperacional: Date;
  abertoEm: Date;
  fechadoEm: Date;
}): Prisma.ComandaWhereInput {
  return sessao.tipoEncerramento === 'ADMINISTRATIVO'
    ? { sessaoCaixaRealizacaoId: sessao.id }
    : { diaOperacional: sessao.diaOperacional, fechadaEm: { gte: sessao.abertoEm, lte: sessao.fechadoEm } };
}

export async function buscarRelatorioTurnoFechado(sessaoId: string, cervejariaId: string) {
  const sessao = await prisma.sessaoCaixaOperacao.findFirst({
    where: { id: sessaoId, cervejariaId, status: 'FECHADO' },
    include: { movimentos: true, pontoVenda: { select: { id: true, nome: true } } },
  });
  if (!sessao?.fechadoEm) {
    throw new CaixaInvalidoError('Turno não encontrado');
  }

  const caixa = await montarResumoCaixa(sessao, cervejariaId);
  const usuarioIds = [sessao.abertoPorId, sessao.fechadoPorId].filter(Boolean) as string[];
  const usuarios = usuarioIds.length
    ? await prisma.usuario.findMany({
        where: { id: { in: usuarioIds } },
        select: { id: true, nome: true },
      })
    : [];
  const nomeUsuario = (id: string | null) => usuarios.find((usuario) => usuario.id === id)?.nome ?? null;
  const administrativo = sessao.tipoEncerramento === 'ADMINISTRATIVO';
  const escopo = escopoComandasDoTurno({ ...sessao, fechadoEm: sessao.fechadoEm });
  const vendasAvulsas = await prisma.comanda.count({
    where: {
      origem: 'CAIXA',
      pontoVenda: { cervejariaId },
      pontoVendaId: sessao.pontoVendaId,
      tipo: 'AVULSA',
      status: 'FECHADA',
      ...(administrativo ? escopo : { fechadaEm: { gte: sessao.abertoEm, lte: sessao.fechadoEm } }),
    },
  });

  const duracaoMinutos = Math.max(
    1,
    Math.round((sessao.fechadoEm.getTime() - sessao.abertoEm.getTime()) / 60_000),
  );
  const duracaoHoras = Math.max(0.25, Math.round((duracaoMinutos / 60) * 100) / 100);

  const comandas = await prisma.comanda.findMany({
    where: {
      origem: 'CAIXA',
      pontoVenda: { cervejariaId },
      pontoVendaId: sessao.pontoVendaId,
      status: 'FECHADA',
      ...escopo,
    },
    include: {
      cliente: { select: { id: true, nome: true } },
      contaReceber: {
        include: {
          cliente: { select: { id: true, nome: true } },
          pagamentos: { select: { forma: true, valor: true, pagoEm: true, sessaoCaixaId: true }, orderBy: { pagoEm: 'asc' } },
        },
      },
      itens: {
        include: {
          produto: { select: { categoria: true } },
        },
      },
    },
  });
  const comandasAtendidas = comandas.length;
  const vendasTotal = comandas.reduce((soma, comanda) => soma + toNumber(comanda.total), 0);

  const porProduto = new Map<
    string,
    { produtoId: string; nome: string; categoria: string; volumeMl: number; quantidade: number; receita: number }
  >();
  const porCliente = new Map<string, { clienteId: string; nome: string; comandas: number; consumo: number }>();
  const contasReceber: Array<{
    contaReceberId: string;
    comandaNumero: number | null;
    identificador: string | null;
    clienteNome: string;
    valorOriginal: number;
    recebido: number;
    saldo: number;
    recebimentos: Array<{ forma: string; valor: number; pagoEm: Date; nesteTurno: boolean }>;
  }> = [];
  const contasPendentes: Array<{
    contaReceberId: string;
    comandaNumero: number | null;
    identificador: string | null;
    clienteNome: string;
    valorOriginal: number;
    recebido: number;
    saldo: number;
  }> = [];
  let itensVendidos = 0;

  for (const comanda of comandas) {
    if (comanda.clienteId && comanda.cliente) {
      const cliente = porCliente.get(comanda.clienteId) ?? {
        clienteId: comanda.clienteId,
        nome: comanda.cliente.nome,
        comandas: 0,
        consumo: 0,
      };
      cliente.comandas += 1;
      cliente.consumo += toNumber(comanda.total);
      porCliente.set(comanda.clienteId, cliente);
    }

    if (comanda.contaReceber) {
      const conta = comanda.contaReceber;
      const recebido = conta.pagamentos.reduce((soma, pagamento) => soma + toNumber(pagamento.valor), 0);
      const valorOriginal = toNumber(conta.valorOriginal);
      const saldo = Math.max(0, Math.round((valorOriginal - recebido) * 100) / 100);
      const recebimentos = conta.pagamentos.map((pagamento) => ({
        forma: pagamento.forma,
        valor: toNumber(pagamento.valor),
        pagoEm: pagamento.pagoEm,
        nesteTurno: pagamento.sessaoCaixaId === sessao.id,
      }));
      contasReceber.push({
        contaReceberId: conta.id,
        comandaNumero: comanda.numero,
        identificador: comanda.identificador,
        clienteNome: conta.cliente.nome,
        valorOriginal,
        recebido: Math.round(recebido * 100) / 100,
        saldo,
        recebimentos,
      });
      if (saldo > 0) {
        contasPendentes.push({
          contaReceberId: conta.id,
          comandaNumero: comanda.numero,
          identificador: comanda.identificador,
          clienteNome: conta.cliente.nome,
          valorOriginal,
          recebido,
          saldo: Math.round(saldo * 100) / 100,
        });
      }
    }

    for (const item of comanda.itens) {
      if (!item.produtoId || !itemContaNaVendaLiquida(item)) continue;
      itensVendidos += item.quantidade;
      const itemValor = toNumber(item.precoUnit) * item.quantidade;
      const volumeMl = item.volumeMl ?? 0;
      const chaveProduto = `${item.produtoId}:${volumeMl}`;
      const categoria = item.tapId ? 'Chope' : item.produto?.categoria?.trim() || 'Outros';
      const nome = item.nome ?? 'Item';
      const nomeComVolume = volumeMl > 0 && !new RegExp(`\\b${volumeMl}\\s*ml\\b`, 'i').test(nome)
        ? `${nome} (${volumeMl} ml)`
        : nome;
      const prod = porProduto.get(chaveProduto) ?? {
        produtoId: item.produtoId,
        nome: nomeComVolume,
        categoria,
        volumeMl,
        quantidade: 0,
        receita: 0,
      };
      prod.quantidade += item.quantidade;
      prod.receita += itemValor;
      porProduto.set(chaveProduto, prod);
    }
  }

  const receitaTotal = vendasTotal;
  const porProdutoArr = Array.from(porProduto.values())
    .map((produto) => ({
      ...produto,
      receita: Math.round(produto.receita * 100) / 100,
      percentual: receitaTotal > 0 ? Math.round((produto.receita / receitaTotal) * 100) : 0,
    }))
    .sort((a, b) => b.receita - a.receita);
  const porClienteArr = Array.from(porCliente.values())
    .map((cliente) => ({ ...cliente, consumo: Math.round(cliente.consumo * 100) / 100 }))
    .sort((a, b) => b.consumo - a.consumo)
    .slice(0, 5);

  return {
    caixa,
    dadosFinanceirosDisponiveis: true,
    conferenciaFisicaPendente: administrativo,
    pontoNome: sessao.pontoVenda.nome,
    abertoPorNome: nomeUsuario(sessao.abertoPorId) ?? '—',
    fechadoPorNome: nomeUsuario(sessao.fechadoPorId),
    comandasAtendidas,
    vendasTotal,
    totalRecebido: caixa.esperado.totalVendas,
    vendasAvulsas,
    itensVendidos,
    porProduto: porProdutoArr,
    contasReceber,
    ...resumirFiadoDoTurno(contasReceber),
    contasPendentes: contasPendentes.sort((a, b) => b.saldo - a.saldo),
    totalPendente: Math.round(contasPendentes.reduce((soma, conta) => soma + conta.saldo, 0) * 100) / 100,
    topClientes: porClienteArr,
    ticketMedio:
      comandasAtendidas > 0
        ? Math.round((vendasTotal / comandasAtendidas) * 100) / 100
        : 0,
    duracaoMinutos,
    receitaPorHora:
      duracaoHoras > 0
        ? Math.round((vendasTotal / duracaoHoras) * 100) / 100
        : 0,
  };
}
