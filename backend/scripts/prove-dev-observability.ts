import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { provisionEstablishment } from '../src/lib/provision-establishment.js';

/** Invoked by an operator-owned wrapper; credentials and cookies never enter evidence. */
export async function proveDevObservability(options: {
  expectedSha: string; databaseUrl: string;
  elastic: (path: string, body?: unknown) => Promise<any>;
}) {
  assert.match(options.expectedSha, /^[a-f0-9]{40}$/);
  const db = new URL(options.databaseUrl);
  assert(['localhost', '127.0.0.1'].includes(db.hostname) && db.port === '5434' && db.pathname === '/cervejaria_dev', 'Only the local DEV database is permitted');
  const base = 'http://127.0.0.1:3002';
  const health = await (await fetch(base + '/api/health')).json() as any;
  assert.equal(health.releaseSha, options.expectedSha, 'Published DEV release differs');
  const prisma = new PrismaClient({ datasourceUrl: options.databaseUrl });
  const run = randomUUID();
  const password = randomBytes(24).toString('base64url');
  const email = `tap96-${run}@example.invalid`;
  let fixture: any;
  let cookie = '';
  const correlations = { create: randomUUID(), update: randomUUID() };
  const interactionId = randomUUID();
  async function api(method: string, route: string, body: unknown, correlationId = randomUUID()) {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', cookie, 'x-correlation-id': correlationId, 'x-interaction-id': interactionId }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    if (route === '/api/auth/login') cookie = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    assert(response.ok, `DEV proof HTTP ${response.status} at ${route}`);
    return await response.json() as any;
  }
  try {
    fixture = await prisma.$transaction(tx => provisionEstablishment(tx, {
      nome: `Sintético TAP96 ${run}`, slug: `tap96-proof-${run}`,
      dono: { nome: 'Operador Sintético TAP96', email, senhaHash: '' },
      enablements: { plannedOperations: false, taps: false, inventory: false, kitchen: false },
    }, { mode: 'CANONICAL' }));
    await prisma.usuario.update({ where: { id: fixture.dono.id }, data: { senhaHash: await bcrypt.hash(password, 10) } });
    await api('POST', '/api/auth/login', { email, senha: password });
    const category = await prisma.categoriaProdutoPdv.create({ data: { cervejariaId: fixture.cervejaria.id, nome: 'Prova TAP96', nomeNormalizado: 'prova tap96' } });
    const product = await api('POST', '/api/operacao/produtos', { nome: 'Produto Sintético TAP96', categoria: category.nome, categoriaPdvId: category.id, tipo: 'BEBIDA', formato: 'LATA', precoUnit: 7.25, controlaEstoque: false }, correlations.create);
    await api('PUT', `/api/operacao/produtos/${product.id}`, { ativo: false, precoUnit: 8.5 }, correlations.update);
    const persisted = await prisma.produto.findFirstOrThrow({ where: { id: product.id, cervejariaId: fixture.cervejaria.id }, include: { precos: true } });
    assert.equal(persisted.ativo, false);
    assert.equal(Number(persisted.precos[0].preco), 8.5);
    let events: any[] = [];
    for (let attempt = 0; attempt < 90; attempt++) {
      const result = await options.elastic('/logs-audit*.otel-dev*/_search', { size: 100, query: { bool: { filter: [{ terms: { 'attributes.correlationId': Object.values(correlations) } }, { term: { 'attributes.cervejaria.id': fixture.cervejaria.id } }] } } });
      events = (result.hits?.hits ?? []).map((hit: any) => ({ index: hit._index, ...hit._source.attributes }));
      if (events.some(e => e['event.action'] === 'db.transaction.committed') && events.filter(e => ['http.post', 'http.put'].includes(e['event.action'])).length >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const update = events.filter(e => e.correlationId === correlations.update);
    const http = update.find(e => e['event.action'] === 'http.put');
    assert(http, 'Updated HTTP event missing from live Elastic');
    assert.equal(http.metadata?.requestBody?.ativo, false);
    assert.equal(http.metadata?.payloadPolicy?.omitted, true);
    assert(!JSON.stringify(events).includes(password));
    assert(!JSON.stringify(events).includes(email));
    const receipt = update.find(e => e['event.action'] === 'db.write.completed' && e['entity.id'] === product.id);
    assert(receipt, 'Persistence receipt missing');
    assert.equal(receipt['db.transaction.state'], 'committed');
    assert(update.some(e => e['event.action'] === 'db.transaction.committed' && e['db.transaction.id'] === receipt['db.transaction.id']));
    for (const event of events) {
      assert.equal(event.releaseSha, options.expectedSha);
      assert.equal(event['actor.id'], fixture.dono.id);
      assert.equal(event['cervejaria.id'], fixture.cervejaria.id);
      assert.equal(event.interactionId, interactionId);
      assert(event['event.id'] && event.requestId);
    }
    return { passed: true, observedAt: new Date().toISOString(), releaseSha: health.releaseSha, tenantId: fixture.cervejaria.id, operatorId: fixture.dono.id, productId: product.id, correlations, interactionId, persisted: { ativo: persisted.ativo, preco: Number(persisted.precos[0].preco) }, eventCount: events.length, events, scope: 'Actual DEV API, database and Elastic; not a synthetic browser interaction' };
  } finally {
    cookie = '';
    if (fixture) {
      // Keep the evidence relation intact; revoke access and hide the synthetic tenant.
      await prisma.usuario.update({ where: { id: fixture.dono.id }, data: { ativo: false } });
      await prisma.cervejaria.update({ where: { id: fixture.cervejaria.id }, data: { ativo: false } });
    }
    await prisma.$disconnect();
  }
}
