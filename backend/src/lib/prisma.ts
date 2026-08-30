import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { createPrismaObservabilityExtension, observeDbTransaction } from './prisma-observability.js';

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
const baseClient = new PrismaClient(
  databaseUrl
    ? { datasources: { db: { url: databaseUrl } } }
    : undefined,
);
const extended = baseClient.$extends(createPrismaObservabilityExtension());

// Prisma query extensions cover individual operations. This proxy adds one
// distinct transaction signal and deliberately ignores functional rollbacks.
const observed = new Proxy(extended, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (property !== '$transaction' || typeof value !== 'function') return value;
    return (...args: unknown[]) => observeDbTransaction(() => value.apply(target, args));
  },
});

export const prisma = observed as unknown as PrismaClient;
export type DbClient = Prisma.TransactionClient | PrismaClient;
