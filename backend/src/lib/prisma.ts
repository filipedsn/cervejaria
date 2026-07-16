import { PrismaClient } from '@prisma/client';
import { createPrismaAuditExtension } from './prisma-audit.js';

const baseClient = new PrismaClient();
const extended = baseClient.$extends(createPrismaAuditExtension());

export const prisma = extended as unknown as PrismaClient;
