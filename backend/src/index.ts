import './lib/load-env.js';
import { buildApp, setupSocketIO } from './app.js';
import { startKibanaAlertPoller, stopKibanaAlertPoller } from './lib/kibana-alert-poller.js';
import { prisma } from './lib/prisma.js';
import { registerProcessErrorHandlers } from './lib/process-handlers.js';
import { getReleaseContext } from './lib/release-context.js';
import { initializeTechnicalTelemetry, shutdownTechnicalTelemetry } from './lib/technical-telemetry-logger.js';
import { shutdownSdk } from './lib/telemetry-shutdown.js';
import { logger } from './lib/logger.js';
import { registerDevRuntimeControl } from './lib/dev-runtime-control.js';

registerProcessErrorHandlers(() => shutdown(1));
let activeApp: Awaited<ReturnType<typeof buildApp>> | undefined;
let shuttingDown = false;

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  initializeTechnicalTelemetry();
  const app = await buildApp();
  activeApp = app;
  registerDevRuntimeControl(app, () => shutdown(0));
  setupSocketIO(app, app.server);

  await app.listen({ port: PORT, host: HOST });

  app.log.info({ ...getReleaseContext() }, `API rodando em http://${HOST}:${PORT}`);
  startKibanaAlertPoller(app.log, 'api');
}

main().catch(async (err) => {
  logger.error({ err }, 'API startup failed');
  await shutdown(1);
});

async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(code || 1), 10_000);
  deadline.unref();
  stopKibanaAlertPoller();
  try {
    await activeApp?.close();
    await prisma.$disconnect();
    await Promise.allSettled([shutdownTechnicalTelemetry(), shutdownSdk()]);
  } finally { clearTimeout(deadline); process.exit(code); }
}
process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));
