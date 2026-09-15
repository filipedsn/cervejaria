import { prisma } from './prisma.js';

export interface OperationalCapabilities {
  cashRegister: boolean;
  inventory: boolean;
  kitchen: boolean;
  taps: boolean;
  directSales: boolean;
  plannedOperations: boolean;
}

export interface OperationalProfileFacts {
  tenantId: string;
  legacyQuiosque: {
    enabled: boolean;
    exclusivo: boolean;
    controlaEstoque: boolean;
    temCozinha: boolean;
  } | null;
  activeTrailers: number;
  activePointsOfSale: number;
  activePointOfSaleCashRegisterSettings: Array<boolean | null>;
  operationalEnablement?: {
    directSalesEnabled: boolean | null;
    plannedOperationsEnabled: boolean | null;
    tapsEnabled: boolean | null;
    inventoryEnabled: boolean | null;
    kitchenEnabled: boolean | null;
  } | null;
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
    quiosqueEnabled: boolean;
    exclusivo: boolean | null;
  };
}

export type OperationalProfileFactsReader = (
  tenantId: string,
) => Promise<OperationalProfileFacts | null>;

/** Pure mapping so legacy configurations can be validated without database I/O. */
export function deriveOperationalProfile(facts: OperationalProfileFacts): OperationalProfile {
  const quiosqueEnabled = facts.legacyQuiosque?.enabled === true;
  const hasDirectSaleUnit = quiosqueEnabled && facts.activePointsOfSale > 0;
  const legacyCashRegister = hasDirectSaleUnit;
  const directSalesEnabled = facts.operationalEnablement?.directSalesEnabled ?? hasDirectSaleUnit;
  const plannedOperationsEnabled = facts.operationalEnablement?.plannedOperationsEnabled ?? facts.activeTrailers > 0;
  const tapsEnabled = facts.operationalEnablement?.tapsEnabled ?? facts.activeTaps > 0;
  const inventoryEnabled = facts.operationalEnablement?.inventoryEnabled
    ?? (quiosqueEnabled && facts.legacyQuiosque!.controlaEstoque);
  const kitchenEnabled = facts.operationalEnablement?.kitchenEnabled
    ?? (quiosqueEnabled && facts.legacyQuiosque!.temCozinha);
  // Older in-memory fact producers only supplied the unit count. Interpret
  // their missing settings as NULL so the legacy fallback remains compatible.
  const cashRegisterSettings = facts.activePointOfSaleCashRegisterSettings.length > 0
    ? facts.activePointOfSaleCashRegisterSettings
    : Array<boolean | null>(facts.activePointsOfSale).fill(null);
  const hasCashRegisterUnit = cashRegisterSettings.some(
    (usaCaixa) => usaCaixa ?? legacyCashRegister,
  );

  return {
    tenantId: facts.tenantId,
    capabilities: {
      // The current direct-sale route requires an open SessaoCaixaQuiosque.
      // A POS-capable tenant can therefore operate the cash-register workflow,
      // while an event-only tenant remains valid without it.
      cashRegister: hasCashRegisterUnit,
      inventory: inventoryEnabled,
      kitchen: kitchenEnabled,
      // Taps are evidenced by active physical resources, never tenant naming.
      taps: tapsEnabled,
      // Today, direct sales are the POS flow and require an active POS unit.
      directSales: directSalesEnabled,
      // Today, an active Trailer is the prerequisite unit for Evento creation.
      plannedOperations: plannedOperationsEnabled,
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
      quiosqueEnabled,
      exclusivo: quiosqueEnabled ? facts.legacyQuiosque!.exclusivo : null,
    },
  };
}

/**
 * Performs exactly one tenant-scoped Prisma read. It intentionally has no
 * mutation delegate, transaction, raw SQL, cache or side effect.
 */
export const readOperationalProfileFacts: OperationalProfileFactsReader = async (tenantId) => {
  const tenant = await prisma.cervejaria.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      configuracaoQuiosque: {
        select: {
          ativo: true,
          exclusivo: true,
          controlaEstoque: true,
          temCozinha: true,
        },
      },
      configuracaoOperacional: {
        select: {
          directSalesEnabled: true,
          plannedOperationsEnabled: true,
          tapsEnabled: true,
          inventoryEnabled: true,
          kitchenEnabled: true,
        },
      },
      trailers: { where: { ativo: true }, select: { id: true } },
      pontosVenda: { where: { ativo: true }, select: { id: true, usaCaixa: true } },
      taps: { where: { ativo: true }, select: { id: true } },
      eventos: { select: { status: true } },
      sessoesCaixaQuiosque: { where: { status: 'ABERTO' }, select: { id: true } },
    },
  });

  if (!tenant) return null;

  const legacyQuiosque = tenant.configuracaoQuiosque?.ativo
    ? {
        enabled: true,
        exclusivo: tenant.configuracaoQuiosque.exclusivo,
        controlaEstoque: tenant.configuracaoQuiosque.controlaEstoque,
        temCozinha: tenant.configuracaoQuiosque.temCozinha,
      }
    : null;
  const plannedOperationCount = tenant.eventos.length;
  const openPlannedOperationCount = tenant.eventos.filter((evento) => evento.status === 'ABERTO').length;

  return {
    tenantId: tenant.id,
    legacyQuiosque,
    activeTrailers: tenant.trailers.length,
    activePointsOfSale: tenant.pontosVenda.length,
    activePointOfSaleCashRegisterSettings: tenant.pontosVenda.map((pontoVenda) => pontoVenda.usaCaixa),
    operationalEnablement: tenant.configuracaoOperacional,
    activeTaps: tenant.taps.length,
    plannedOperationCount,
    openPlannedOperationCount,
    openCashRegisterCount: tenant.sessoesCaixaQuiosque.length,
  };
};

export async function getOperationalProfile(
  tenantId: string,
  readFacts: OperationalProfileFactsReader = readOperationalProfileFacts,
): Promise<OperationalProfile | null> {
  const facts = await readFacts(tenantId);
  return facts ? deriveOperationalProfile(facts) : null;
}
