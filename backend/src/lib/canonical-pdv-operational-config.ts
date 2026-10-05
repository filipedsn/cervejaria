import { prisma } from './prisma.js';

export type CanonicalPdvOperationalSettings = {
  source: 'CANONICAL_PDV';
  pointId: string;
  tapsEnabled: boolean;
  inventoryEnabled: boolean;
  kitchenEnabled: boolean;
  kitchenItemsChargeAtLaunch: boolean;
  allowCloseComandaWithPendingKitchenOrders: boolean;
  whatsappPedidoProntoEnabled: boolean;
  whatsappPedidoProntoNaCozinha: boolean;
  quantidadeMesas: number | null;
};

type PdvConfigCandidate = {
  id: string;
  cervejariaId: string;
  ativo: boolean;
  configuracaoPdv: (Omit<CanonicalPdvOperationalSettings, 'source' | 'pointId'> & { cervejariaId: string; pontoVendaId: string }) | null;
};

type CanonicalPdvClient = Pick<typeof prisma, 'pontoVenda'>;

export class CanonicalPdvConfigurationError extends Error {
  readonly statusCode = 409;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CanonicalPdvConfigurationError';
  }
}

/**
 * Temporary opt-in used only by the owned disposable QA runner. Invalid QA
 * activation fails closed; with the flag absent, no additive table is read.
 */
export function canonicalPdvQaActivationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PDV_CANONICAL_CONFIG_QA !== '1') return false;

  let target: URL;
  try {
    target = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new CanonicalPdvConfigurationError('CANONICAL_PDV_QA_GUARD_FAILED', 'Ativação canônica permitida somente no PostgreSQL QA descartável.');
  }
  const port = Number(target.port);
  if (
    env.NODE_ENV !== 'test' ||
    env.PDV_ISOLATED_QA !== '1' ||
    !env.DATABASE_URL ||
    env.QA_DATABASE_URL !== env.DATABASE_URL ||
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.hostname !== '127.0.0.1' ||
    !Number.isInteger(port) || port < 55439 || port > 55449 ||
    target.pathname !== '/cervejaria_qa_pdv_unico'
  ) {
    throw new CanonicalPdvConfigurationError('CANONICAL_PDV_QA_GUARD_FAILED', 'Ativação canônica permitida somente no PostgreSQL QA descartável.');
  }
  return true;
}

export function resolveCanonicalPdvOperationalSettings(
  tenantId: string,
  points: readonly PdvConfigCandidate[],
): CanonicalPdvOperationalSettings {
  if (points.length === 0) {
    throw new CanonicalPdvConfigurationError('CANONICAL_PDV_MISSING', 'O tenant não possui PDV canônico.');
  }
  if (points.length !== 1) {
    throw new CanonicalPdvConfigurationError('CANONICAL_PDV_AMBIGUOUS', 'O tenant deve possuir exatamente um PDV para ativar a configuração canônica.');
  }
  const point = points[0]!;
  if (point.cervejariaId !== tenantId) {
    throw new CanonicalPdvConfigurationError('CANONICAL_PDV_TENANT_MISMATCH', 'O PDV selecionado pertence a outro tenant.');
  }
  if (!point.ativo) {
    throw new CanonicalPdvConfigurationError('CANONICAL_PDV_INACTIVE', 'O PDV canônico está inativo.');
  }
  const config = point.configuracaoPdv;
  if (!config) {
    throw new CanonicalPdvConfigurationError('CANONICAL_PDV_CONFIGURATION_MISSING', 'O PDV canônico não possui configuração operacional.');
  }
  if (config.cervejariaId !== tenantId || config.pontoVendaId !== point.id) {
    throw new CanonicalPdvConfigurationError('CANONICAL_PDV_CONFIGURATION_MISMATCH', 'A configuração operacional não pertence ao PDV e tenant selecionados.');
  }
  const { cervejariaId: _tenantId, pontoVendaId: _pointId, ...settings } = config;
  return { ...settings, source: 'CANONICAL_PDV', pointId: point.id };
}

/** Returns null without touching quiosque.ConfiguracaoPontoVenda when disabled. */
export async function readCanonicalPdvOperationalSettingsIfEnabled(
  tenantId: string,
  db: CanonicalPdvClient = prisma,
): Promise<CanonicalPdvOperationalSettings | null> {
  if (!canonicalPdvQaActivationEnabled()) return null;
  const points = await db.pontoVenda.findMany({
    where: { cervejariaId: tenantId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      cervejariaId: true,
      ativo: true,
      configuracaoPdv: {
        select: {
          cervejariaId: true,
          pontoVendaId: true,
          tapsEnabled: true,
          inventoryEnabled: true,
          kitchenEnabled: true,
          kitchenItemsChargeAtLaunch: true,
          allowCloseComandaWithPendingKitchenOrders: true,
          whatsappPedidoProntoEnabled: true,
          whatsappPedidoProntoNaCozinha: true,
          quantidadeMesas: true,
        },
      },
    },
  });
  return resolveCanonicalPdvOperationalSettings(tenantId, points as PdvConfigCandidate[]);
}
