import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ActionError, executeAction, readAudit } from './actions.mjs';
import { previewRange } from './collectors/git.mjs';
import { fetchPr } from './collectors/github.mjs';
import { collectPrd } from './collectors/prd.mjs';
import { config, PANEL_DIR } from './config.mjs';
import { isAllowedAction, isTrustedLocalOperator } from './local-auth.mjs';
import { collectSnapshot } from './snapshot.mjs';
import { deriveState } from './state.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;
const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);

const app = Fastify({ logger: false });

app.addHook('onRequest', async (request, reply) => {
  const auth = { port: config.port };
  if (!allowedHosts.has(String(request.headers.host)) || !isTrustedLocalOperator(request, auth)) {
    return reply.code(403).send({ error: 'O painel só atende o navegador desta máquina.' });
  }
  if (request.method === 'POST' && !isAllowedAction(request, auth)) {
    return reply.code(403).send({ error: 'Ação sem o header do painel.' });
  }
});

await app.register(fastifyStatic, { root: join(PANEL_DIR, 'public') });

app.get('/api/health', async () => ({ ok: true, app: 'quiver-tap-ops', version: 2, pid: process.pid }));

app.get('/api/state', async (request) => {
  const snapshot = await collectSnapshot({ force: request.query.force === '1' });
  return { ...deriveState(snapshot), audit: readAudit(), repo: config.repo };
});

app.get('/api/preview/deploy', async (request, reply) => {
  const to = String(request.query.to ?? '');
  if (!SHA_RE.test(to)) return reply.code(400).send({ error: 'SHA inválido.' });
  const prd = await collectPrd();
  if (!prd.releaseSha) return reply.code(409).send({ error: 'Não foi possível ler a versão atual de produção.' });
  return previewRange(prd.releaseSha, to);
});

app.get('/api/preview/pr/:number', async (request, reply) => {
  const number = Number(request.params.number);
  if (!Number.isSafeInteger(number) || number <= 0) return reply.code(400).send({ error: 'PR inválido.' });
  return fetchPr(number);
});

app.post('/api/actions/:name', async (request, reply) => {
  try {
    const message = await executeAction(request.params.name, request.body?.params ?? {});
    return { ok: true, message };
  } catch (error) {
    return reply.code(error instanceof ActionError ? 409 : 500).send({ ok: false, error: error.message });
  }
});

app.setErrorHandler((error, _request, reply) => {
  reply.code(error.statusCode ?? 500).send({ error: error.message });
});

await app.listen({ host: config.host, port: config.port });
mkdirSync(config.runtimeDir, { recursive: true });
writeFileSync(join(config.runtimeDir, 'ops-panel.pid'), String(process.pid), 'ascii');
console.log(`Quiver Tap Ops: http://${config.host}:${config.port}`);
