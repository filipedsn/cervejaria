import { randomUUID } from 'node:crypto';
import { test, expect, seed, type Tenant } from '../support/ops';
import { prismaClient } from '../support/fixtures';

const esURL = process.env.TAP96_ES_URL;
const base = (tenant: Pick<Tenant, 'slug' | 'pointId'>) =>
  `/api/public/cervejarias/${tenant.slug}/pontos-venda/${tenant.pointId}`;

async function poll<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const until = Date.now() + 35_000;
  let value = await read();
  while (!accept(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    value = await read();
  }
  expect(accept(value), label).toBe(true);
  return value;
}

async function search(index: string, body: Record<string, unknown>) {
  if (!esURL) throw new Error('TAP96_ES_URL must target disposable Elasticsearch.');
  const response = await fetch(`${esURL}/${index}/_search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Disposable Elasticsearch query failed: HTTP ${response.status}`);
  return response.json() as Promise<{ hits: { hits: Array<{ _id: string; _index: string; _source: Record<string, any> }> } }>;
}

test('TAP96 payment-request routes persist once and export searchable DEV signals @api', async ({ ops, evidence }) => {
  test.setTimeout(90_000); // includes the configured 30s OTEL metric export interval
  if (!esURL) throw new Error('TAP96_ES_URL must target disposable Elasticsearch.');
  const tenant = await ops.tenant();
  await tenant.openCash();
  const client = await ops.anonymous('synthetic-pdv-customer');
  const open = await client.expect(client.post(`${base(tenant)}/comandas`, {
    nome: 'Cliente Sintético TAP96', telefone: `119${String(Date.now()).slice(-8)}`,
  }), 201, 'open disposable PDV command');
  const commandId = open.comanda.id as string;
  // A separate browser context is required: opening a new comanda replaces the
  // PDV session cookie, so reusing `client` would make it point at the sibling.
  const siblingClient = await ops.anonymous('synthetic-pdv-sibling');
  const sibling = await siblingClient.expect(siblingClient.post(`${base(tenant)}/comandas`, {
    nome: 'Comanda Irmã TAP96', telefone: `118${String(Date.now() - 100).slice(-8)}`,
  }), 201, 'open sibling command');
  const ownerB = await ops.persona('ownerB');
  const ownerId = (await prismaClient().usuario.findUniqueOrThrow({ where: { email: tenant.ownerEmail }, select: { id: true } })).id as string;
  const ids = Object.fromEntries(['request1', 'requestRetry', 'wrongCommand', 'foreignTenant', 'foreignPdv', 'resolve1', 'resolveRetry', 'request2', 'resolve2'].map((k) => [k, randomUUID()])) as Record<string, string>;
  const requestPath = `${base(tenant)}/comanda/solicitar-pagamento`;
  const readCommand = () => prismaClient().comanda.findUniqueOrThrow({ where: { id: commandId }, select: { clienteId: true, solicitacaoPagamentoEm: true, pontoVenda: { select: { cervejariaId: true } } } });
  const paymentCount = () => prismaClient().pagamento.count({ where: { comandaId: commandId } });
  const responses: Array<{ status: number; requestId?: string }> = [];

  async function call(api: typeof client, actor: string, method: string, url: string, correlationId: string) {
    const response = await api.ctx.fetch(url, { method, headers: { 'x-correlation-id': correlationId }, failOnStatusCode: false });
    const raw = await response.text();
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* do not retain response payload */ }
    const requestId = response.headers()['x-request-id'];
    responses.push({ status: response.status(), requestId });
    evidence.recordApi({ actor, method, url, status: response.status(), requestId, correlationId: response.headers()['x-correlation-id'] });
    return { status: response.status(), body, requestId };
  }

  const first = await call(client, 'synthetic-pdv-customer', 'POST', requestPath, ids.request1);
  expect(first.status).toBe(200);
  // Fastify exposes no request-id response header by default. The per-request
  // ID is asserted below on the searchable semantic event.
  const persisted = await readCommand();
  expect(persisted.pontoVenda.cervejariaId).toBe(tenant.id);
  expect(persisted.solicitacaoPagamentoEm).toBeInstanceOf(Date);
  const retry = await call(client, 'synthetic-pdv-customer', 'POST', requestPath, ids.requestRetry);
  expect(retry.status).toBe(200);
  expect(retry.body.pendente).toBe(true);
  expect((await readCommand()).solicitacaoPagamentoEm?.getTime()).toBe(persisted.solicitacaoPagamentoEm!.getTime());

  const wrongCommand = await call(tenant.owner, 'ownerA', 'DELETE', `/api/operacao/comandas/${sibling.comanda.id}/solicitacao-pagamento`, ids.wrongCommand);
  expect(wrongCommand.status).toBe(404);
  const wrongTenant = await call(ownerB, 'ownerB', 'DELETE', `/api/operacao/comandas/${commandId}/solicitacao-pagamento`, ids.foreignTenant);
  expect(wrongTenant.status).toBe(404);
  const foreignPdv = await call(client, 'synthetic-pdv-customer', 'POST',
    `/api/public/cervejarias/${seed.tenants[1]!.slug}/pontos-venda/${seed.points[seed.tenants[1]!.id]}/comanda/solicitar-pagamento`, ids.foreignPdv);
  expect(foreignPdv.status).toBe(403);
  expect((await readCommand()).solicitacaoPagamentoEm?.getTime()).toBe(persisted.solicitacaoPagamentoEm!.getTime());

  const resolved = await call(tenant.owner, 'ownerA', 'DELETE', `/api/operacao/comandas/${commandId}/solicitacao-pagamento`, ids.resolve1);
  expect(resolved.status).toBe(200);
  expect((await readCommand()).solicitacaoPagamentoEm).toBeNull();
  const resolveRetry = await call(tenant.owner, 'ownerA', 'DELETE', `/api/operacao/comandas/${commandId}/solicitacao-pagamento`, ids.resolveRetry);
  expect(resolveRetry.status).toBe(404);
  expect((await readCommand()).solicitacaoPagamentoEm).toBeNull();
  const secondRequest = await call(client, 'synthetic-pdv-customer', 'POST', requestPath, ids.request2);
  expect(secondRequest.status).toBe(200);
  expect((await readCommand()).solicitacaoPagamentoEm).toBeInstanceOf(Date);
  const resolved2 = await call(tenant.owner, 'ownerA', 'DELETE', `/api/operacao/comandas/${commandId}/solicitacao-pagamento`, ids.resolve2);
  expect(resolved2.status).toBe(200);
  expect((await readCommand()).solicitacaoPagamentoEm).toBeNull();
  expect(await paymentCount()).toBe(0);

  let audit: Array<{ _id: string; _index: string; _source: Record<string, any> }> = [];
  await poll(async () => {
    const result = await search('logs-*.otel-dev', {
      size: 500, query: { term: { 'attributes.test.run.id': seed.runId } },
      _source: ['body', 'message', 'msg', 'severity_text', 'severity_number', 'attributes.log.logger', 'attributes.log.record.original', 'attributes.data_stream.dataset', 'attributes.event.action', 'attributes.event.outcome', 'attributes.cervejaria.id', 'attributes.cervejaria.slug', 'attributes.actor.id', 'attributes.actor.type', 'attributes.releaseSha', 'attributes.requestId', 'attributes.correlationId', 'attributes.test.run.id', 'attributes.http.response.status_code'],
    });
    audit = result.hits.hits;
    const count = (action: string) => audit.filter((hit) => hit._source.attributes?.['event.action'] === action).length;
    return { requested: count('payment.requested'), resolved: count('payment.request_resolved') };
  }, (counts) => counts.requested >= 2 && counts.resolved >= 2, 'semantic payment transitions searchable across log families');

  for (const [action, correlationIds] of Object.entries({
    'payment.requested': [ids.request1, ids.request2],
    'payment.request_resolved': [ids.resolve1, ids.resolve2],
  })) {
    const matches = audit.filter((hit) => hit._source.attributes?.['event.action'] === action);
    expect(matches).toHaveLength(2);
    expect(matches.map((hit) => hit._source.attributes?.correlationId).sort()).toEqual([...correlationIds].sort());
    for (const hit of matches) {
      const attrs = hit._source.attributes;
      expect(attrs['event.outcome']).toBe('success');
      expect(attrs['cervejaria.id']).toBe(tenant.id);
      expect(attrs['cervejaria.slug']).toBe(tenant.slug);
      expect(attrs.releaseSha).toBe(seed.releaseSha);
      expect(attrs['test.run.id']).toBe(seed.runId);
      expect(attrs.requestId).toBeTruthy();
      expect(attrs['actor.type']).toBe(action === 'payment.requested' ? 'cliente-pdv' : 'usuario');
      expect(attrs['actor.id']).toBe(action === 'payment.requested' ? persisted.clienteId : ownerId);
    }
  }
  expect(audit.filter((hit) => hit._source.attributes?.['event.action'] === 'payment.requested').length).toBeGreaterThanOrEqual(2);
  expect(audit.filter((hit) => hit._source.attributes?.['event.action'] === 'payment.request_resolved').length).toBeGreaterThanOrEqual(2);
  expect(audit.some((hit) => hit._source.attributes?.['event.action'] === 'SALE_PAYMENT_RECORDED')).toBe(false);
  for (const retryCorrelation of [ids.requestRetry, ids.resolveRetry]) {
    expect(audit.some((hit) => hit._source.attributes?.correlationId === retryCorrelation &&
      ['payment.requested', 'payment.request_resolved'].includes(hit._source.attributes?.['event.action']))).toBe(false);
  }
  for (const denied of [
    { correlationId: ids.wrongCommand, status: 404, companyId: tenant.id, actorId: ownerId, actorType: 'usuario' },
    { correlationId: ids.foreignTenant, status: 404, companyId: seed.tenants[1]!.id, actorId: seed.users.ownerB!.id, actorType: 'usuario' },
    { correlationId: ids.foreignPdv, status: 403, companyId: tenant.id, actorId: persisted.clienteId, actorType: 'cliente-pdv' },
  ]) {
    const event = audit.find((hit) => hit._source.attributes?.correlationId === denied.correlationId &&
      hit._source.attributes?.['http.response.status_code'] === denied.status);
    expect(event, `denial event for ${denied.status}`).toBeTruthy();
    expect(event!._source.attributes?.['event.outcome']).toBe('failure');
    expect(event!._source.attributes?.['cervejaria.id']).toBe(denied.companyId);
    expect(event!._source.attributes?.['actor.id']).toBe(denied.actorId);
    expect(event!._source.attributes?.['actor.type']).toBe(denied.actorType);
    expect(event!._source.attributes?.releaseSha).toBe(seed.releaseSha);
    expect(event!._source.attributes?.['test.run.id']).toBe(seed.runId);
  }
  expect(responses).toHaveLength(9);

  const auditIds = audit.map((hit) => `${hit._index}/${hit._id}`);
  expect(new Set(auditIds).size).toBe(auditIds.length);
  const semanticDocs = audit.filter((hit) => ['payment.requested', 'payment.request_resolved'].includes(hit._source.attributes?.['event.action']));
  const transitionCorrelations = [ids.request1, ids.request2, ids.resolve1, ids.resolve2];
  const transitionDocs = audit.filter((hit) => transitionCorrelations.includes(hit._source.attributes?.correlationId));
  const expectedSignals = [
    { correlationId: ids.request1, semantic: 'payment.requested', http: 'http.post' },
    { correlationId: ids.request2, semantic: 'payment.requested', http: 'http.post' },
    { correlationId: ids.resolve1, semantic: 'payment.request_resolved', http: 'http.delete' },
    { correlationId: ids.resolve2, semantic: 'payment.request_resolved', http: 'http.delete' },
  ];
  expect(semanticDocs).toHaveLength(4);
  expect(transitionDocs).toHaveLength(8);
  for (const expected of expectedSignals) {
    const docs = transitionDocs.filter((hit) => hit._source.attributes?.correlationId === expected.correlationId);
    expect(docs).toHaveLength(2);
    expect(docs.map((hit) => hit._source.attributes?.['event.action']).sort()).toEqual([expected.semantic, expected.http].sort());
    for (const hit of docs) {
      const attrs = hit._source.attributes;
      const isRequest = expected.semantic === 'payment.requested';
      expect(attrs['event.outcome']).toBe('success');
      expect(attrs['cervejaria.id']).toBe(tenant.id);
      expect(attrs['cervejaria.slug']).toBe(tenant.slug);
      expect(attrs['actor.id']).toBe(isRequest ? persisted.clienteId : ownerId);
      expect(attrs['actor.type']).toBe(isRequest ? 'cliente-pdv' : 'usuario');
      expect(attrs.releaseSha).toBe(seed.releaseSha);
      expect(attrs['test.run.id']).toBe(seed.runId);
      expect(attrs.requestId).toBeTruthy();
    }
  }
  const documentEvidence = transitionDocs.map((hit) => ({
    index: hit._index,
    id: hit._id,
    dataset: hit._source.attributes?.['data_stream.dataset'],
    action: hit._source.attributes?.['event.action'],
    correlationId: hit._source.attributes?.correlationId,
    requestId: hit._source.attributes?.requestId,
    body: hit._source.body,
    message: hit._source.message,
    severityText: hit._source.severity_text,
    msg: hit._source.msg,
    loggerName: hit._source.attributes?.['log.logger'],
    pinoOriginal: hit._source.attributes?.['log.record.original'],
    origin: hit._source.attributes?.['event.action']?.startsWith('payment.')
      ? 'recordPaymentRequestTransition -> semantic business event'
      : 'registerAuditHooks.onResponse -> HTTP result event',
  }));
  test.info().annotations.push({ type: 'tap96-document-origins', description: JSON.stringify({
    runId: seed.runId, releaseSha: seed.releaseSha,
    documents: documentEvidence,
    expectedSignals,
    documentsPerTransition: 2,
    duplicateSemanticEvents: 0,
  }) });

  let metrics: Array<Record<string, any>> = [];
  await poll(async () => {
    const result = await search('metrics-generic.otel-dev*', {
      size: 100, sort: [{ '@timestamp': 'desc' }],
      query: { bool: { filter: [
        { term: { 'resource.attributes.service.name': 'quiver-tap-api-qa' } },
        { terms: { 'attributes.quiver.payment_request.action': ['requested', 'resolved'] } },
      ] } },
      _source: ['data_stream', 'resource.attributes', 'attributes.quiver.payment_request.action', 'metrics.quiver.payment_request.total'],
    });
    metrics = result.hits.hits.map((hit) => hit._source);
    return new Set(metrics.map((doc) => doc.attributes?.['quiver.payment_request.action']));
  }, (actions) => actions.has('requested') && actions.has('resolved'), 'metrics indexed in metrics-generic.otel-dev');
  expect(metrics.every((doc) => doc.data_stream?.namespace === 'dev')).toBe(true);
  expect(metrics.every((doc) => doc.resource?.attributes?.['deployment.environment.name'] === 'development')).toBe(true);
  expect(metrics.every((doc) => {
    const attributes = doc.resource?.attributes ?? {};
    return !Object.keys(attributes).some((key) => key.startsWith('host.') || key.startsWith('process.'));
  })).toBe(true);
  for (const action of ['requested', 'resolved']) {
    expect(metrics.some((doc) => doc.attributes?.['quiver.payment_request.action'] === action && Number(doc.metrics?.['quiver.payment_request.total']) >= 2)).toBe(true);
  }
  test.info().annotations.push({ type: 'tap96-evidence', description: JSON.stringify({
    runId: seed.runId, releaseSha: seed.releaseSha, companyId: tenant.id, commandId,
    persistedRequests: 2, persistedResolutions: 2, financialPayments: await paymentCount(),
    searchableTransitions: { persisted: { requested: 2, resolved: 2 }, semanticDocs: { requested: audit.filter((hit) => hit._source.attributes?.['event.action'] === 'payment.requested').length, resolved: audit.filter((hit) => hit._source.attributes?.['event.action'] === 'payment.request_resolved').length }, duplicateNewTransitions: 0 },
    rejections: { siblingCommand: 404, otherCompany: 404, foreignPoint: 403 },
    metricDestination: 'metrics-generic.otel-dev', correlations: Object.values(ids),
    transitionDocuments: documentEvidence,
  }) });
});
