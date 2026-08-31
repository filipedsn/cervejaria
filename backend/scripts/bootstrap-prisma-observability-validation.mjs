import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAddHookMessageChannel,
  startNodeSDK,
} from '@elastic/opentelemetry-node/sdk';

const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The Elastic SDK reads its Pino log-sending opt-in while it is created. Load
// the validation's local telemetry settings before registering instrumentation.
for (const line of fs.readFileSync(path.join(backendRoot, '.env.development'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(OTEL_[A-Z0-9_]+|ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING|LOG_LEVEL)=(.*)$/);
  if (!match) continue;
  const [, key, raw] = match;
  if (!process.env[key]) process.env[key] = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
}

// Same Elastic hook/SDK used by `--import @elastic/opentelemetry-node`, but
// keep the lifecycle handle so this short-lived validator can drain telemetry.
const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
register('@elastic/opentelemetry-node/hook.mjs', import.meta.url, registerOptions);

const telemetry = startNodeSDK({ elasticSetupShutdownHandlers: false });
await waitForAllMessagesAcknowledged();

try {
  await import('./validate-prisma-elastic-ingestion.ts');
} finally {
  await telemetry.shutdown();
}
