import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { observePrismaClient } from './observed-prisma.js';

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
const canonicalActivationConfigured = process.env.PDV_CANONICAL_ALL === '1' || Boolean(process.env.PDV_CANONICAL_TENANTS);
const canonicalSchemaOmit = process.env.PDV_CANONICAL_CONFIG_QA === '1' || canonicalActivationConfigured
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
    ...(process.env.PDV_GAMIFIED_CATEGORY_CATALOG !== '1' && !canonicalActivationConfigured ? { categoriaPdvId: true } : {}),
  },
};
const baseClient = new PrismaClient(
  databaseUrl
    ? { datasources: { db: { url: databaseUrl } }, ...(legacySchemaOmit ? { omit: legacySchemaOmit } : {}) }
    : undefined,
);
export const prisma = observePrismaClient(baseClient);
export type DbClient = Prisma.TransactionClient | PrismaClient;
