import { register } from 'node:module';
import {
  createAddHookMessageChannel,
  startNodeSDK,
} from '@elastic/opentelemetry-node/sdk';

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
