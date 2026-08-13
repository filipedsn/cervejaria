import http from 'node:http';
import './lib/load-env.js';
import { startKibanaAlertPoller, stopKibanaAlertPoller } from './lib/kibana-alert-poller.js';
import { createLogger } from './lib/logger.js';

const log = createLogger();
const HEALTH_PORT = parseInt(process.env.ALERT_POLLER_HEALTH_PORT ?? '3098', 10);

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'quiver-tap-alert-poller' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(HEALTH_PORT, '127.0.0.1', () => {
  log.info({ port: HEALTH_PORT }, 'Alert poller worker health endpoint');
});

startKibanaAlertPoller(log, 'worker');

process.on('SIGINT', () => {
  stopKibanaAlertPoller();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopKibanaAlertPoller();
  server.close();
  process.exit(0);
});
