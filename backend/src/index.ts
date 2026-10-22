import './lib/load-env.js';
import { buildApp, setupSocketIO } from './app.js';
import { startKibanaAlertPoller, stopKibanaAlertPoller } from './lib/kibana-alert-poller.js';
import { prisma } from './lib/prisma.js';
import { registerProcessErrorHandlers } from './lib/process-handlers.js';
import { getReleaseContext } from './lib/release-context.js';
import { initializeTechnicalTelemetry, shutdownTechnicalTelemetry } from './lib/technical-telemetry-logger.js';
import { renewAgendaWindows } from './lib/operacao/agenda.js';

registerProcessErrorHandlers();

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
let agendaRenewalTimer: ReturnType<typeof setInterval> | null = null;

async function main() {
  initializeTechnicalTelemetry();
  const app = await buildApp();
  setupSocketIO(app, app.server);

  await app.listen({ port: PORT, host: HOST });

  app.log.info({ ...getReleaseContext() }, `API rodando em http://${HOST}:${PORT}`);
  startKibanaAlertPoller(app.log, 'api');
  const renew = () => void renewAgendaWindows(prisma).then((result) => { app.log.info(result, 'Janela finita de recorrências da agenda renovada'); for (const failure of result.falhas) app.log.warn(failure, 'Regra da agenda não foi renovada por conflito ou falha'); }).catch((error) => app.log.error({ err: error }, 'Falha ao renovar recorrências da agenda'));
  renew();
  agendaRenewalTimer = setInterval(renew, 6 * 60 * 60 * 1000);
}

main().catch(async (err) => {
  console.error(err);
  await shutdownTechnicalTelemetry();
  await prisma.$disconnect();
  process.exit(1);
});

process.on('SIGINT', async () => {
  if (agendaRenewalTimer) clearInterval(agendaRenewalTimer);
  stopKibanaAlertPoller();
  await shutdownTechnicalTelemetry();
  await prisma.$disconnect();
  process.exit(0);
});
