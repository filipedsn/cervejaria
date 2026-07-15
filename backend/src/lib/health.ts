import { prisma } from './prisma.js';

export type HealthCheckResult = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

export async function checkDatabase(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'database unreachable',
    };
  }
}

export async function getReadinessStatus() {
  const db = await checkDatabase();
  const checks = { database: db };
  const ready = db.ok;

  return {
    status: ready ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks,
  };
}
