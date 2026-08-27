import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { createPrismaAuditExtension } from './prisma-audit.js';

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

const baseClient = new PrismaClient({
  datasources: {
    db: { url: databaseUrlWithPool(process.env.DATABASE_URL) },
  },
});
const extended = baseClient.$extends(createPrismaAuditExtension());

export const prisma = extended as unknown as PrismaClient;
export type DbClient = Prisma.TransactionClient | PrismaClient;
