import './lib/load-env.js';
import { buildApp, setupSocketIO } from './app.js';
import { startKibanaAlertPoller, stopKibanaAlertPoller } from './lib/kibana-alert-poller.js';
import { prisma } from './lib/prisma.js';
import { registerProcessErrorHandlers } from './lib/process-handlers.js';
import { getReleaseContext } from './lib/release-context.js';

registerProcessErrorHandlers();

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  const app = await buildApp();
  setupSocketIO(app, app.server);

  await app.listen({ port: PORT, host: HOST });

  app.log.info({ ...getReleaseContext() }, `API rodando em http://${HOST}:${PORT}`);
  startKibanaAlertPoller(app.log, 'api');
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('SIGINT', async () => {
  stopKibanaAlertPoller();
  await prisma.$disconnect();
  process.exit(0);
});
