import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runWithTelemetryContext } from '../src/lib/telemetry-context.js';
import { classifyDbError, isDbTechnicalError, prismaErrorCode } from '../src/lib/prisma-observability.js';

const isolatedPort = 65432;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');

function loadDevelopmentTelemetryEnv(): void {
  const envFile = path.join(backendRoot, '.env.development');
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(OTEL_[A-Z0-9_]+|ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING|LOG_LEVEL)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!process.env[key]) process.env[key] = value;
  }
}

async function assertUnusedLoopbackPort(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`A porta isolada ${isolatedPort} já está em uso`)));
    server.listen(isolatedPort, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  loadDevelopmentTelemetryEnv();
  await assertUnusedLoopbackPort();

  // Process-local only: this never changes the API DEV process or its database.
  process.env.NODE_ENV = 'development';
  process.env.DATABASE_URL = `postgresql://isolated:isolated@127.0.0.1:${isolatedPort}/isolated?connect_timeout=2`;
  const correlationId = process.env.PRISMA_OBS_CORRELATION_ID ?? randomUUID();

  const { prisma } = await import('../src/lib/prisma.js');
  try {
    await runWithTelemetryContext(
      {
        correlationId,
        slug: 'system',
        env: 'dev',
        actor: { type: 'system' },
      },
      () => prisma.$queryRaw`SELECT 1`,
    );
    throw new Error('A conexão isolada respondeu inesperadamente');
  } catch (error) {
    if (!isDbTechnicalError(error) || classifyDbError(error) !== 'CONNECTION') throw error;
    console.log(JSON.stringify({
      correlationId,
      event: 'db.connection.failed',
      category: 'CONNECTION',
      errorName: error instanceof Error ? error.name : 'DatabaseError',
      prismaCode: prismaErrorCode(error),
    }));
  } finally {
    await prisma.$disconnect();
  }

}

await main();
