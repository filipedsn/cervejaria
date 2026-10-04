import { createHash } from 'node:crypto';
import { deriveOperationalProfile } from '../src/lib/operational-profile.js';

export const PDV_CATALOG_SCOPE = 'PDV_CONFIGURACAO_CATALOGO_V1';
// v2 changes Decimal canonicalization from rounded two-place output to exact decimal text.
// Existing v1 receipts are intentionally rejected by transform-version checks, never rewritten.
export const PDV_CATALOG_TRANSFORM_VERSION = 2;
const noopFallback = () => undefined;

export class PdvCatalogBlocker extends Error {
  constructor(readonly code: string, readonly sourceType: string | null, readonly sourceId: string | null, message: string) {
    super(message);
    this.name = 'PdvCatalogBlocker';
  }
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    if ('toFixed' in value && typeof (value as { toFixed?: unknown }).toFixed === 'function') {
      const decimal = value as { toString: () => string };
      return JSON.stringify(decimal.toString());
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const canonicalPdvPayloadHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const sourceKey = (type: string, id: string) => `${type}:${id}`;

function jsonSafe(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toFixed === 'function') return value.toFixed(2);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  return value;
}

export interface CatalogTransformInput {
  companyId: string;
  pointId: string;
  snapshot: any;
  confirmedPdvSourceKey: string;
}

export interface CatalogMigrationItem {
  type: string;
  id: string;
  destinationType: string;
  destinationId: string;
  sourcePayload: unknown;
  destinationData: Record<string, unknown>;
  dependencies: string[];
}

const dto = (row: any, relations: string[] = []) => Object.fromEntries(Object.entries(row).filter(([key]) => !relations.includes(key) && key !== 'pontoVendaId'));

function effectiveConfiguration(companyId: string, snapshot: any, pointId: string) {
  const legacy = snapshot.moduleConfig;
  const current = snapshot.operationalConfig;
  const profile = deriveOperationalProfile({
    tenantId: companyId,
    legacyOperacao: legacy ? { enabled: legacy.ativo, exclusivo: legacy.exclusivo, controlaEstoque: legacy.controlaEstoque, temCozinha: legacy.temCozinha } : null,
    activeTrailers: snapshot.trailers.filter((row: any) => row.ativo).length,
    activePointsOfSale: snapshot.pdvs.filter((row: any) => row.ativo).length,
    activePointOfSaleCashRegisterSettings: snapshot.pdvs.filter((row: any) => row.ativo).map((row: any) => row.usaCaixa),
    operationalEnablement: current ? {
      plannedOperationsEnabled: current.plannedOperationsEnabled,
      tapsEnabled: current.tapsEnabled,
      inventoryEnabled: current.inventoryEnabled,
      kitchenEnabled: current.kitchenEnabled,
    } : null,
    activeTaps: snapshot.taps.filter((row: any) => row.ativo).length,
    plannedOperationCount: snapshot.events.length,
    openPlannedOperationCount: snapshot.events.filter((row: any) => row.status === 'ABERTO').length,
    openCashRegisterCount: snapshot.operationalSessions.filter((row: any) => row.status === 'ABERTO').length,
  }, noopFallback);

  const configurationRows = [current, legacy].filter(Boolean);
  if (configurationRows.length === 0) throw new PdvCatalogBlocker('CONFIGURATION_SOURCE_MISSING', 'PDV_CONFIGURACAO', pointId, 'Nenhuma configuração legada tem timestamp para preservar na configuração efetiva do PDV.');
  const sourceCreatedAt = configurationRows.map((row: any) => row.createdAt).filter(Boolean).map((value: Date) => value.getTime());
  const sourceUpdatedAt = configurationRows.map((row: any) => row.updatedAt).filter(Boolean).map((value: Date) => value.getTime());
  if (sourceCreatedAt.length !== configurationRows.length || sourceUpdatedAt.length !== configurationRows.length) throw new PdvCatalogBlocker('CONFIGURATION_TIMESTAMP_MISSING', 'PDV_CONFIGURACAO', pointId, 'Timestamp ausente em uma configuração legada; o migrador não fabrica timestamps.');

  // These four switches are persisted with NOT NULL false defaults; deployed consumers treat a missing row as false.
  const config = {
    id: `config-pdv:${pointId}`,
    cervejariaId: companyId,
    pontoVendaId: pointId,
    tapsEnabled: profile.capabilities.taps,
    inventoryEnabled: profile.capabilities.inventory,
    kitchenEnabled: profile.capabilities.kitchen,
    kitchenItemsChargeAtLaunch: current?.kitchenItemsChargeAtLaunch ?? false,
    allowCloseComandaWithPendingKitchenOrders: current?.allowCloseComandaWithPendingKitchenOrders ?? false,
    whatsappPedidoProntoEnabled: current?.whatsappPedidoProntoEnabled ?? false,
    whatsappPedidoProntoNaCozinha: current?.whatsappPedidoProntoNaCozinha ?? false,
    quantidadeMesas: legacy?.quantidadeMesas ?? 0,
    createdAt: new Date(Math.min(...sourceCreatedAt)),
    updatedAt: new Date(Math.max(...sourceUpdatedAt)),
  };
  return {
    config,
    sourcePayload: jsonSafe({
      legacyConfiguration: current,
      legacyModuleConfiguration: legacy,
      resolved: { tapsEnabled: profile.capabilities.taps, inventoryEnabled: profile.capabilities.inventory, kitchenEnabled: profile.capabilities.kitchen },
    }),
  };
}

/** Pure mapping from the complete shared source snapshot to existing catalog rows plus optional canonical PDV links. */
export function buildPdvCatalogMigrationItems(input: CatalogTransformInput): CatalogMigrationItem[] {
  const { companyId, pointId, snapshot } = input;
  if (!/^(PDV|TRAILER):.+/.test(input.confirmedPdvSourceKey)) throw new PdvCatalogBlocker('PDV_DEPENDENCY_NOT_CONFIRMED', 'PDV', pointId, 'O PDV canônico ainda não foi confirmado pelo escopo operacional anterior.');
  if (snapshot.pdvs.length !== 1 || snapshot.pdvs[0].id !== pointId || snapshot.pdvs[0].cervejariaId !== companyId) throw new PdvCatalogBlocker('CANONICAL_PDV_AMBIGUOUS', 'PDV', pointId, 'A fotografia não comprova um único PDV canônico para atribuir o catálogo inteiro.');
  const byId = new Map(snapshot.products.map((row: any) => [row.id, row]));
  const items: CatalogMigrationItem[] = [];
  const config = effectiveConfiguration(companyId, snapshot, pointId);
  items.push({ type: 'PDV_CONFIGURACAO', id: pointId, destinationType: 'CONFIGURACAO_PONTO_VENDA', destinationId: config.config.id, sourcePayload: config.sourcePayload, destinationData: config.config, dependencies: [input.confirmedPdvSourceKey] });

  const add = (type: string, row: any, destinationType: string, destinationData: Record<string, unknown>, dependencies: string[] = []) => {
    const payload = jsonSafe({ ...row, transformVersion: PDV_CATALOG_TRANSFORM_VERSION });
    items.push({ type, id: row.id, destinationType, destinationId: row.id, sourcePayload: payload, destinationData, dependencies: [...dependencies, input.confirmedPdvSourceKey] });
  };

  for (const row of snapshot.products) {
    if (row.cervejariaId !== companyId) throw new PdvCatalogBlocker('PRODUCT_TENANT_MISMATCH', 'CATALOGO_PRODUTO', row.id, 'Produto relacionado a outro tenant.');
    const payload = { ...dto(row, ['precos', 'gruposOpcionais']), transformVersion: PDV_CATALOG_TRANSFORM_VERSION };
    add('CATALOGO_PRODUTO', payload, 'PRODUTO', { ...dto(row, ['precos', 'gruposOpcionais']), pontoVendaId: pointId });
    for (const price of row.precos) add('CATALOGO_PRECO', price, 'PRECO', dto(price), [`CATALOGO_PRODUTO:${row.id}`]);
    for (const group of row.gruposOpcionais) {
      add('CATALOGO_GRUPO_OPCIONAL', group, 'PRODUTO_OPCIONAL_GRUPO', dto(group, ['opcoes']), [`CATALOGO_PRODUTO:${row.id}`]);
      for (const option of group.opcoes) {
        if (option.produtoEstoqueId && (!byId.has(option.produtoEstoqueId) || (byId.get(option.produtoEstoqueId) as any).cervejariaId !== companyId)) throw new PdvCatalogBlocker('OPTION_STOCK_PRODUCT_TENANT_MISMATCH', 'CATALOGO_OPCAO', option.id, 'Produto de estoque da opção não foi encontrado no mesmo tenant.');
        add('CATALOGO_OPCAO', option, 'PRODUTO_OPCIONAL', dto(option, ['produtoEstoque']), [`CATALOGO_GRUPO_OPCIONAL:${group.id}`]);
      }
    }
  }
  for (const menu of snapshot.menus) {
    if (menu.cervejariaId !== companyId) throw new PdvCatalogBlocker('MENU_TENANT_MISMATCH', 'CATALOGO_CARDAPIO', menu.id, 'Cardápio relacionado a outro tenant.');
    add('CATALOGO_CARDAPIO', menu, 'CARDAPIO', { ...dto(menu, ['produtos']), pontoVendaId: pointId });
    for (const entry of menu.produtos) {
      if (entry.produto?.cervejariaId !== companyId || !byId.has(entry.produtoId)) throw new PdvCatalogBlocker('MENU_PRODUCT_TENANT_MISMATCH', 'CATALOGO_CARDAPIO_ITEM', entry.id, 'Item do cardápio aponta para produto ausente ou de outro tenant.');
      add('CATALOGO_CARDAPIO_ITEM', entry, 'CARDAPIO_PRODUTO', { ...dto(entry, ['produto']), cervejariaId: companyId, pontoVendaId: pointId }, [`CATALOGO_CARDAPIO:${menu.id}`, `CATALOGO_PRODUTO:${entry.produtoId}`]);
    }
  }
  const optionalById = new Map(snapshot.optionals.map((row: any) => [row.id, row]));
  for (const optional of snapshot.optionals) {
    if (optional.cervejariaId !== companyId) throw new PdvCatalogBlocker('OPTIONAL_TENANT_MISMATCH', 'CATALOGO_OPCIONAL', optional.id, 'Adicional relacionado a outro tenant.');
    add('CATALOGO_OPCIONAL', optional, 'OPCIONAL', { ...dto(optional, ['produtos']), pontoVendaId: pointId });
    for (const link of optional.produtos) {
      if (!byId.has(link.produtoId)) throw new PdvCatalogBlocker('OPTIONAL_PRODUCT_MISSING', 'CATALOGO_VINCULO_OPCIONAL', link.id, 'Vínculo de adicional aponta para produto ausente.');
      if (!optionalById.has(link.opcionalId)) throw new PdvCatalogBlocker('OPTIONAL_REFERENCE_MISSING', 'CATALOGO_VINCULO_OPCIONAL', link.id, 'Vínculo aponta para adicional ausente.');
      add('CATALOGO_VINCULO_OPCIONAL', link, 'PRODUTO_OPCIONAL_VINCULO', { ...dto(link), cervejariaId: companyId, pontoVendaId: pointId }, [`CATALOGO_PRODUTO:${link.produtoId}`, `CATALOGO_OPCIONAL:${link.opcionalId}`]);
    }
  }
  const order: Record<string, number> = {
    PDV_CONFIGURACAO: 0, CATALOGO_PRODUTO: 1, CATALOGO_PRECO: 2, CATALOGO_GRUPO_OPCIONAL: 3,
    CATALOGO_OPCAO: 4, CATALOGO_CARDAPIO: 5, CATALOGO_CARDAPIO_ITEM: 6, CATALOGO_OPCIONAL: 7, CATALOGO_VINCULO_OPCIONAL: 8,
  };
  return items.sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99) || a.id.localeCompare(b.id));
}
