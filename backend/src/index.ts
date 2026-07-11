import './lib/load-env.js';
import { buildApp, setupSocketIO } from './app.js';
import { prisma } from './lib/prisma.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  const app = await buildApp();
  setupSocketIO(app, app.server);

  await app.listen({ port: PORT, host: HOST });

  app.log.info(`API rodando em http://${HOST}:${PORT}`);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
