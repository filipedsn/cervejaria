import { isBebidaChope } from '../produto-utils.js';
import { prisma } from '../prisma.js';
import { diaOperacional } from '../quiosque/venda.js';

export type OnboardingMode = 'CERVEJARIA' | 'QUIOSQUE' | 'HIBRIDA';

export type OnboardingStepCode =
  | 'QUIOSQUE_POINT'
  | 'QUIOSQUE_PRODUCT'
  | 'QUIOSQUE_STOCK'
  | 'QUIOSQUE_CASH_REGISTER'
  | 'QUIOSQUE_FIRST_SALE'
  | 'CERVEJARIA_TRAILER'
  | 'CERVEJARIA_PRODUCT'
  | 'CERVEJARIA_TAP'
  | 'CERVEJARIA_OPERATION'
  | 'CERVEJARIA_FIRST_SALE';

export interface OnboardingStep {
  code: OnboardingStepCode;
  complete: boolean;
}

interface ModuleReadinessFacts {
  enabled: boolean;
  hasActivePointOrTrailer: boolean;
  hasSellableProduct: boolean;
  hasSellableAssociation: boolean;
  hasOpenOperation: boolean;
}

export interface OnboardingReadinessFacts {
  quiosque: ModuleReadinessFacts & {
    controlaEstoque: boolean;
    temCozinha: boolean;
  };
  cervejaria: ModuleReadinessFacts;
  hasHistoricalSale: boolean;
}

export interface OnboardingModuleReadiness {
  enabled: boolean;
  ready: boolean;
  missingSteps: OnboardingStep[];
}

export interface OnboardingReadiness {
  mode: OnboardingMode;
  capacities: {
    controlaEstoque: boolean;
    temCozinha: boolean;
  };
  hasHistoricalSale: boolean;
  firstSaleCompleted: boolean;
  operationReady: boolean;
  canConfigure: boolean;
  modules: {
    quiosque: OnboardingModuleReadiness;
    cervejaria: OnboardingModuleReadiness;
  };
}

function step(code: OnboardingStepCode): OnboardingStep {
  return { code, complete: false };
}

function moduleReadiness(
  enabled: boolean,
  hasHistoricalSale: boolean,
  requirements: Array<{ complete: boolean; code: OnboardingStepCode }>,
  firstSaleCode: OnboardingStepCode,
): OnboardingModuleReadiness {
  if (!enabled) return { enabled: false, ready: false, missingSteps: [] };

  const missingSteps = requirements.filter((requirement) => !requirement.complete).map(({ code }) => step(code));
  const ready = missingSteps.length === 0;
  if (ready && !hasHistoricalSale) missingSteps.push(step(firstSaleCode));

  return { enabled: true, ready, missingSteps };
}

/**
 * Pure contract builder. Keeping the decisions here makes the API and its
 * tests share one definition without turning UI state into persisted data.
 */
export function deriveOnboardingReadiness(
  facts: OnboardingReadinessFacts,
  canConfigure: boolean,
): OnboardingReadiness {
  const quiosqueRequirements: Array<{ complete: boolean; code: OnboardingStepCode }> = [
    { code: 'QUIOSQUE_POINT', complete: facts.quiosque.hasActivePointOrTrailer },
    { code: 'QUIOSQUE_PRODUCT', complete: facts.quiosque.hasSellableProduct || facts.quiosque.hasSellableAssociation },
    { code: 'QUIOSQUE_STOCK', complete: facts.quiosque.hasSellableAssociation },
    { code: 'QUIOSQUE_CASH_REGISTER', complete: facts.quiosque.hasOpenOperation },
  ];
  const quiosque = moduleReadiness(facts.quiosque.enabled, facts.hasHistoricalSale, quiosqueRequirements.filter((requirement) => {
    // A point is a prerequisite for stock and an open cash register; do not
    // advertise downstream actions before the owner has a point to use.
    if (!facts.quiosque.hasActivePointOrTrailer && requirement.code !== 'QUIOSQUE_POINT') return false;
    // No product means there is no stock decision to make yet.
    if (!facts.quiosque.hasSellableProduct && requirement.code === 'QUIOSQUE_STOCK') return false;
    // Stock is a module concern only when stock control is enabled.
    if (!facts.quiosque.controlaEstoque && requirement.code === 'QUIOSQUE_STOCK') return false;
    // A cash register only matters after at least one product can be sold.
    if (!facts.quiosque.hasSellableAssociation && requirement.code === 'QUIOSQUE_CASH_REGISTER') return false;
    return true;
  }), 'QUIOSQUE_FIRST_SALE');

  const cervejariaRequirements: Array<{ complete: boolean; code: OnboardingStepCode }> = [
    { code: 'CERVEJARIA_TRAILER', complete: facts.cervejaria.hasActivePointOrTrailer },
    { code: 'CERVEJARIA_PRODUCT', complete: facts.cervejaria.hasSellableProduct },
    { code: 'CERVEJARIA_TAP', complete: facts.cervejaria.hasSellableAssociation },
    { code: 'CERVEJARIA_OPERATION', complete: facts.cervejaria.hasOpenOperation },
  ];
  const cervejaria = moduleReadiness(facts.cervejaria.enabled, facts.hasHistoricalSale, cervejariaRequirements.filter((requirement) => {
    if (!facts.cervejaria.hasActivePointOrTrailer && requirement.code !== 'CERVEJARIA_TRAILER') return false;
    if (!facts.cervejaria.hasSellableProduct && requirement.code === 'CERVEJARIA_TAP') return false;
    if (!facts.cervejaria.hasSellableAssociation && requirement.code === 'CERVEJARIA_OPERATION') return false;
    return true;
  }), 'CERVEJARIA_FIRST_SALE');

  const mode: OnboardingMode = facts.quiosque.enabled
    ? facts.cervejaria.enabled
      ? 'HIBRIDA'
      : 'QUIOSQUE'
    : 'CERVEJARIA';

  return {
    mode,
    capacities: {
      controlaEstoque: facts.quiosque.enabled && facts.quiosque.controlaEstoque,
      temCozinha: facts.quiosque.enabled && facts.quiosque.temCozinha,
    },
    hasHistoricalSale: facts.hasHistoricalSale,
    firstSaleCompleted: facts.hasHistoricalSale,
    operationReady: quiosque.ready || cervejaria.ready,
    canConfigure,
    modules: { quiosque, cervejaria },
  };
}

async function collectQuiosqueFacts(cervejariaId: string, controlaEstoque: boolean, temCozinha: boolean) {
  const [points, products] = await Promise.all([
    prisma.pontoVenda.findMany({ where: { cervejariaId, ativo: true }, select: { id: true } }),
    prisma.produtoQuiosque.findMany({
      where: { cervejariaId, ativo: true, precoUnit: { gt: 0 } },
      select: { id: true, controlaEstoque: true },
    }),
  ]);

  const pointIds = points.map((point) => point.id);
  const productIds = products.map((product) => product.id);
  const [saldos, sessions] = await Promise.all([
    controlaEstoque && pointIds.length > 0 && productIds.length > 0
      ? prisma.estoqueSaldoQuiosque.findMany({
          where: {
            cervejariaId,
            pontoVendaId: { in: pointIds },
            produtoId: { in: productIds },
            quantidade: { gte: 1 },
          },
          select: { pontoVendaId: true, produtoId: true },
        })
      : Promise.resolve([]),
    pointIds.length > 0
      ? prisma.sessaoCaixaQuiosque.findMany({
          where: {
            cervejariaId,
            pontoVendaId: { in: pointIds },
            diaOperacional: diaOperacional(),
            status: 'ABERTO',
          },
          select: { pontoVendaId: true },
        })
      : Promise.resolve([]),
  ]);

  const saldoPairs = new Set(saldos.map((saldo) => `${saldo.pontoVendaId}:${saldo.produtoId}`));
  const sellablePointIds = new Set<string>();
  for (const pointId of pointIds) {
    for (const product of products) {
      if (!controlaEstoque || !product.controlaEstoque || saldoPairs.has(`${pointId}:${product.id}`)) {
        sellablePointIds.add(pointId);
      }
    }
  }

  return {
    enabled: true,
    controlaEstoque,
    temCozinha,
    hasActivePointOrTrailer: pointIds.length > 0,
    hasSellableProduct: products.length > 0,
    hasSellableAssociation: sellablePointIds.size > 0,
    hasOpenOperation: sessions.some((session) => sellablePointIds.has(session.pontoVendaId)),
  };
}

async function collectCervejariaFacts(cervejariaId: string) {
  const [trailers, products] = await Promise.all([
    prisma.trailer.findMany({ where: { cervejariaId, ativo: true }, select: { id: true } }),
    prisma.produto.findMany({
      where: { cervejariaId, ativo: true, tipo: 'BEBIDA', precos: { some: { preco: { gt: 0 } } } },
      select: { id: true, tipo: true, formato: true },
    }),
  ]);

  const trailerIds = trailers.map((trailer) => trailer.id);
  const sellableProductIds = new Set(
    products.filter((product) => isBebidaChope(product.tipo, product.formato)).map((product) => product.id),
  );
  const taps = trailerIds.length > 0
    ? await prisma.tap.findMany({
        where: { cervejariaId, trailerId: { in: trailerIds }, ativo: true, produtoId: { in: [...sellableProductIds] } },
        select: { trailerId: true },
      })
    : [];
  const tapTrailerIds = new Set(taps.map((tap) => tap.trailerId));
  const openEvents = tapTrailerIds.size > 0
    ? await prisma.evento.findMany({
        where: { cervejariaId, trailerId: { in: [...tapTrailerIds] }, status: 'ABERTO' },
        select: { trailerId: true },
      })
    : [];

  return {
    enabled: true,
    hasActivePointOrTrailer: trailerIds.length > 0,
    hasSellableProduct: sellableProductIds.size > 0,
    hasSellableAssociation: tapTrailerIds.size > 0,
    hasOpenOperation: openEvents.length > 0,
  };
}

/** Read-only operational state for the authenticated tenant. */
export async function getOnboardingReadiness(cervejariaId: string, canConfigure: boolean) {
  const [configuracaoQuiosque, hasHistoricalSale] = await Promise.all([
    prisma.configuracaoQuiosque.findFirst({
      where: { cervejariaId, ativo: true },
      select: { exclusivo: true, controlaEstoque: true, temCozinha: true },
    }),
    prisma.comanda.count({
      where: {
        status: 'FECHADA',
        itens: { some: {} },
        OR: [
          { evento: { cervejariaId } },
          { pontoVenda: { cervejariaId } },
        ],
      },
    }),
  ]);

  const quiosqueEnabled = Boolean(configuracaoQuiosque);
  const cervejariaEnabled = !configuracaoQuiosque?.exclusivo;
  const [quiosque, cervejaria] = await Promise.all([
    quiosqueEnabled
      ? collectQuiosqueFacts(
          cervejariaId,
          configuracaoQuiosque!.controlaEstoque,
          configuracaoQuiosque!.temCozinha,
        )
      : Promise.resolve({
          enabled: false,
          controlaEstoque: false,
          temCozinha: false,
          hasActivePointOrTrailer: false,
          hasSellableProduct: false,
          hasSellableAssociation: false,
          hasOpenOperation: false,
        }),
    cervejariaEnabled
      ? collectCervejariaFacts(cervejariaId)
      : Promise.resolve({
          enabled: false,
          hasActivePointOrTrailer: false,
          hasSellableProduct: false,
          hasSellableAssociation: false,
          hasOpenOperation: false,
        }),
  ]);

  return deriveOnboardingReadiness({ quiosque, cervejaria, hasHistoricalSale: hasHistoricalSale > 0 }, canConfigure);
}
