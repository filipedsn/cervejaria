import './otel-resource-policy.mjs';
import { register } from 'node:module';
import { isMainThread } from 'node:worker_threads';

if (isMainThread) {
  // Same supported EDOT bootstrap as its --import entry, retaining the handle
  // so application shutdown can drain HTTP/DB before flushing every provider.
  const { startNodeSDK, createAddHookMessageChannel } = await import('@elastic/opentelemetry-node/sdk');
  const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
  register('@elastic/opentelemetry-node/hook.mjs', import.meta.url, registerOptions);
  const sdk = startNodeSDK({ elasticSetupShutdownHandlers: false });
  globalThis[Symbol.for('quiver.otel.sdk')] = sdk;
  await waitForAllMessagesAcknowledged();
}
