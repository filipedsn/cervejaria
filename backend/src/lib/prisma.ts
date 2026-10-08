import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';
import { getTelemetryContext } from './telemetry-context.js';
import { observeDbOperation, observeDbTransaction } from './prisma-observability.js';

function databaseUrlWithPool(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '30');
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '30');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const databaseUrl = databaseUrlWithPool(process.env.DATABASE_URL);
// A coluna da entrega é aditiva. Com o caminho canônico desligado, excluí-la
// dos SELECTs escalares padrão para manter compatibilidade com bancos antigos.
const canonicalSchemaOmit = process.env.PDV_CANONICAL_CONFIG_QA === '1'
  ? {}
  : {
    produto: { prepararEmPedidoSeparado: true },
    comanda: { sessaoCaixaRealizacaoId: true },
  } as const;
const legacySchemaOmit = {
  ...canonicalSchemaOmit,
  produto: {
    ...('produto' in canonicalSchemaOmit ? canonicalSchemaOmit.produto : {}),
    // The category column is additive. Keep old-schema SELECTs compatible
    // whenever the canonical category catalog is switched off.
    categoriaPdvId: process.env.PDV_GAMIFIED_CATEGORY_CATALOG !== '1' ? true : undefined,
  },
};
const baseClient = new PrismaClient(
  databaseUrl
    ? { datasources: { db: { url: databaseUrl } }, ...(legacySchemaOmit ? { omit: legacySchemaOmit } : {}) }
    : undefined,
);
function observeDelegate(model: string, delegate: object): object {
  return new Proxy(delegate, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const context = getTelemetryContext();
        return observeDbOperation(
          { model, operation: property },
          () => value.apply(target, args),
          logger,
          Date.now,
          context,
        );
      };
    },
  });
}

// Capture AsyncLocalStorage before crossing Prisma's native engine boundary.
// This covers all model delegates, raw operations and transactions without
// creating a log for successful normal queries.
const observed = new Proxy(baseClient, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (property === '$transaction' && typeof value === 'function') {
      return (...args: unknown[]) => {
        const context = getTelemetryContext();
        return observeDbTransaction(() => value.apply(target, args), logger, Date.now, context);
      };
    }
    if ((property === '$queryRaw' || property === '$executeRaw') && typeof value === 'function') {
      return (...args: unknown[]) => {
        const context = getTelemetryContext();
        return observeDbOperation(
          { operation: property.slice(1) },
          () => value.apply(target, args),
          logger,
          Date.now,
          context,
        );
      };
    }
    if (typeof property === 'string' && !property.startsWith('$') && typeof value === 'object' && value) {
      return observeDelegate(property, value);
    }
    return value;
  },
});

export const prisma = observed as unknown as PrismaClient;
export type DbClient = Prisma.TransactionClient | PrismaClient;
