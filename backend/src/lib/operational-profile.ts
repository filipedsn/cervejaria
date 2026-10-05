import { prisma } from './prisma.js';
import { recordLegacyFallback, type LegacyFallbackRecorder } from './legacy-fallback.js';
import { readCanonicalPdvOperationalSettingsIfEnabled, type CanonicalPdvOperationalSettings } from './canonical-pdv-operational-config.js';

export interface OperationalCapabilities {
  cashRegister: boolean;
  inventory: boolean;
  kitchen: boolean;
  taps: boolean;
  cashMode: boolean;
  plannedOperations: boolean;
}

export type OperationMode = 'CAIXA' | 'EVENTO';

export interface OperationalProfileFacts {
  tenantId: string;
  legacyOperacao: {
    enabled: boolean;
    exclusivo: boolean;
    controlaEstoque: boolean;
    temCozinha: boolean;
    quantidadeMesas?: number;
  } | null;
  activeTrailers: number;
  activePointsOfSale: number;
  activePointOfSaleCashRegisterSettings: Array<boolean | null>;
  operationalEnablement?: {
    plannedOperationsEnabled: boolean | null;
    tapsEnabled: boolean | null;
    inventoryEnabled: boolean | null;
    kitchenEnabled: boolean | null;
    kitchenItemsChargeAtLaunch?: boolean | null;
    allowCloseComandaWithPendingKitchenOrders?: boolean | null;
    whatsappPedidoProntoEnabled?: boolean | null;
    whatsappPedidoProntoNaCozinha?: boolean | null;
  } | null;
  canonicalPdvSettings?: CanonicalPdvOperationalSettings | null;
  activeTaps: number;
  plannedOperationCount: number;
  openPlannedOperationCount: number;
  openCashRegisterCount: number;
}

/**
 * Read-only description of how the current tenant can operate. The legacy
 * block is diagnostic compatibility data; consumers must use capabilities,
 * operationalUnits and operations rather than recreate a company mode.
 */
export interface OperationalProfile {
  tenantId: string;
  operationMode: OperationMode;
  capabilities: OperationalCapabilities;
  operationalUnits: {
    trailers: number;
    pointsOfSale: number;
  };
  operations: {
    planned: number;
    openPlanned: number;
    openCashRegisters: number;
  };
  legacy: {
    compatibilityOnly: true;
    operacaoEnabled: boolean;
    exclusivo: boolean | null;
  };
  effectiveSettings: {
    source: 'LEGACY' | 'CANONICAL_PDV';
    pointId: string | null;
    tapsEnabled: boolean;
    inventoryEnabled: boolean;
    kitchenEnabled: boolean;
    kitchenItemsChargeAtLaunch: boolean;
    allowCloseComandaWithPendingKitchenOrders: boolean;
    whatsappPedidoProntoEnabled: boolean;
    whatsappPedidoProntoNaCozinha: boolean;
    quantidadeMesas: number;
  };
}

/**
 * The establishment surface is exposed only by current operational
 * capabilities. Legacy ConfiguracaoOperacao presence is not a capability.
 */
export function shouldExposeEstablishmentSurface(
  capabilities: Pick<OperationalCapabilities, 'cashMode' | 'cashRegister' | 'inventory' | 'kitchen'>,
): boolean {
  return capabilities.cashMode || capabilities.cashRegister || capabilities.inventory || capabilities.kitchen;
}

export type OperationalProfileFactsReader = (
  tenantId: string,
) => Promise<OperationalProfileFacts | null>;

/** Pure mapping so legacy configurations can be validated without database I/O. */
export function deriveOperationalProfile(
  facts: OperationalProfileFacts,
  onLegacyFallback: LegacyFallbackRecorder = recordLegacyFallback,
): OperationalProfile {
  const operacaoEnabled = facts.legacyOperacao?.enabled === true;
  const canonical = facts.canonicalPdvSettings;
  // The legacy mode flag is only a compatibility selector while the temporary
  // QA activation is off. Canonical configuration always uses Por Caixa.
  const plannedOperationsEnabled = facts.operationalEnablement?.plannedOperationsEnabled;
  if (!canonical && (plannedOperationsEnabled === null || plannedOperationsEnabled === undefined)) onLegacyFallback('operational_config');
  const operationMode: OperationMode = canonical ? 'CAIXA' : plannedOperationsEnabled === true ? 'EVENTO' : 'CAIXA';
  const tapsEnabled = canonical?.tapsEnabled ?? facts.operationalEnablement?.tapsEnabled ?? facts.activeTaps > 0;
  const inventoryEnabled = canonical?.inventoryEnabled ?? facts.operationalEnablement?.inventoryEnabled
    ?? (operacaoEnabled && facts.legacyOperacao!.controlaEstoque);
  const kitchenEnabled = canonical?.kitchenEnabled ?? facts.operationalEnablement?.kitchenEnabled
    ?? (operacaoEnabled && facts.legacyOperacao!.temCozinha);
  // Every active point of sale is cash-capable in CAIXA. Per-unit legacy
  // toggles are intentionally excluded from this decision.
  const hasCashRegisterUnit = canonical ? true : operationMode === 'CAIXA' && facts.activePointsOfSale > 0;

  return {
    tenantId: facts.tenantId,
    operationMode,
    capabilities: {
      // The current direct-sale route requires an open SessaoCaixaOperacao.
      // A POS-capable tenant can therefore operate the cash-register workflow,
      // while an event-only tenant remains valid without it.
      cashRegister: hasCashRegisterUnit,
      inventory: inventoryEnabled,
      kitchen: kitchenEnabled,
      // Taps are evidenced by active physical resources, never tenant naming.
      taps: tapsEnabled,
      // Today, direct sales are the POS flow and require an active POS unit.
      cashMode: operationMode === 'CAIXA',
      // Today, an active Trailer is the prerequisite unit for Evento creation.
      // Agenda/occurrence remains context; it does not select a second engine.
      plannedOperations: canonical ? false : operationMode === 'EVENTO',
    },
    operationalUnits: {
      trailers: facts.activeTrailers,
      pointsOfSale: facts.activePointsOfSale,
    },
    operations: {
      planned: facts.plannedOperationCount,
      openPlanned: facts.openPlannedOperationCount,
      openCashRegisters: facts.openCashRegisterCount,
    },
    legacy: {
      compatibilityOnly: true,
      operacaoEnabled,
      exclusivo: operacaoEnabled ? facts.legacyOperacao!.exclusivo : null,
    },
    effectiveSettings: {
      source: canonical ? 'CANONICAL_PDV' : 'LEGACY',
      pointId: canonical?.pointId ?? null,
      tapsEnabled,
      inventoryEnabled,
      kitchenEnabled,
      kitchenItemsChargeAtLaunch: canonical?.kitchenItemsChargeAtLaunch ?? facts.operationalEnablement?.kitchenItemsChargeAtLaunch ?? false,
      allowCloseComandaWithPendingKitchenOrders: canonical?.allowCloseComandaWithPendingKitchenOrders ?? facts.operationalEnablement?.allowCloseComandaWithPendingKitchenOrders ?? false,
      whatsappPedidoProntoEnabled: canonical?.whatsappPedidoProntoEnabled ?? facts.operationalEnablement?.whatsappPedidoProntoEnabled ?? false,
      whatsappPedidoProntoNaCozinha: canonical?.whatsappPedidoProntoNaCozinha ?? facts.operationalEnablement?.whatsappPedidoProntoNaCozinha ?? false,
      quantidadeMesas: canonical
        ? canonical.quantidadeMesas ?? 0
        : facts.legacyOperacao?.enabled
          ? facts.legacyOperacao.quantidadeMesas ?? 0
          : 0,
    },
  };
}

/**
 * Performs exactly one tenant-scoped Prisma read. It intentionally has no
 * mutation delegate, transaction, raw SQL, cache or side effect.
 */
export const readOperationalProfileFacts: OperationalProfileFactsReader = async (tenantId) => {
  const canonicalPdvSettings = await readCanonicalPdvOperationalSettingsIfEnabled(tenantId);
  if (canonicalPdvSettings) {
    const tenant = await prisma.cervejaria.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        trailers: { where: { ativo: true }, select: { id: true } },
        pontosVenda: { where: { ativo: true }, select: { id: true } },
        taps: { where: { ativo: true }, select: { id: true } },
        eventos: { select: { status: true } },
        sessoesCaixaOperacao: { where: { status: 'ABERTO' }, select: { id: true } },
      },
    });
    if (!tenant) return null;
    return {
      tenantId: tenant.id,
      legacyOperacao: null,
      activeTrailers: tenant.trailers.length,
      activePointsOfSale: tenant.pontosVenda.length,
      activePointOfSaleCashRegisterSettings: [null],
      canonicalPdvSettings,
      operationalEnablement: null,
      activeTaps: tenant.taps.length,
      plannedOperationCount: tenant.eventos.length,
      openPlannedOperationCount: tenant.eventos.filter((evento) => evento.status === 'ABERTO').length,
      openCashRegisterCount: tenant.sessoesCaixaOperacao.length,
    };
  }

  const tenant = await prisma.cervejaria.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      configuracaoOperacao: {
        select: {
          ativo: true,
          exclusivo: true,
          controlaEstoque: true,
          temCozinha: true,
          quantidadeMesas: true,
        },
      },
      configuracaoOperacional: {
        select: {
          plannedOperationsEnabled: true,
          tapsEnabled: true,
          inventoryEnabled: true,
          kitchenEnabled: true,
          kitchenItemsChargeAtLaunch: true,
          allowCloseComandaWithPendingKitchenOrders: true,
          whatsappPedidoProntoEnabled: true,
          whatsappPedidoProntoNaCozinha: true,
        },
      },
      trailers: { where: { ativo: true }, select: { id: true } },
      pontosVenda: { where: { ativo: true }, select: { id: true } },
      taps: { where: { ativo: true }, select: { id: true } },
      eventos: { select: { status: true } },
      sessoesCaixaOperacao: { where: { status: 'ABERTO' }, select: { id: true } },
    },
  });

  if (!tenant) return null;

  const legacyOperacao = tenant.configuracaoOperacao?.ativo
    ? {
        enabled: true,
        exclusivo: tenant.configuracaoOperacao.exclusivo,
        controlaEstoque: tenant.configuracaoOperacao.controlaEstoque,
        temCozinha: tenant.configuracaoOperacao.temCozinha,
        quantidadeMesas: tenant.configuracaoOperacao.quantidadeMesas,
      }
    : null;
  const plannedOperationCount = tenant.eventos.length;
  const openPlannedOperationCount = tenant.eventos.filter((evento) => evento.status === 'ABERTO').length;

  return {
    tenantId: tenant.id,
    legacyOperacao,
    activeTrailers: tenant.trailers.length,
    activePointsOfSale: tenant.pontosVenda.length,
    activePointOfSaleCashRegisterSettings: tenant.pontosVenda.map(() => null),
    operationalEnablement: tenant.configuracaoOperacional,
    activeTaps: tenant.taps.length,
    plannedOperationCount,
    openPlannedOperationCount,
    openCashRegisterCount: tenant.sessoesCaixaOperacao.length,
  };
};

export async function getOperationalProfile(
  tenantId: string,
  readFacts: OperationalProfileFactsReader = readOperationalProfileFacts,
): Promise<OperationalProfile | null> {
  const facts = await readFacts(tenantId);
  return facts ? deriveOperationalProfile(facts) : null;
}
