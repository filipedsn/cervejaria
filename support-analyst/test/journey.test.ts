import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  auditHitToEvent, buildAuditQuery, buildSummaryPrompt, buildTracesQuery, cleanupJourneys, formatTimeline, groupBySession, journeyFileName,
  parseEnvFile, parseJourneyArgs, readDotted, runJourney, summarizeJourney, traceHitToEvent, type JourneyCriteria,
} from '../src/journey/index.js';

const NOW = new Date('2026-11-01T18:00:00.000Z');

function criteria(overrides: Partial<JourneyCriteria> = {}): JourneyCriteria {
  return { mode: 'usuario', value: 'maria', from: new Date('2026-11-01T12:00:00.000Z'), to: NOW, environment: 'prd', summary: false, limit: 500, ...overrides };
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'journey-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('arguments: exactly one criterion, relative and ISO windows, defaults and bounds', () => {
  const parsed = parseJourneyArgs(['--usuario', 'maria@x.com'], NOW);
  if (!parsed.ok) throw new Error(parsed.reason);
  assert.equal(parsed.criteria.mode, 'usuario');
  assert.equal(parsed.criteria.environment, 'prd');
  assert.equal(parsed.criteria.to.toISOString(), NOW.toISOString());
  assert.equal(parsed.criteria.from.toISOString(), '2026-10-31T18:00:00.000Z');
  const dev = parseJourneyArgs(['--sessao', 'abc-1', '--desde', '30m', '--env', 'dev', '--resumo'], NOW);
  if (!dev.ok) throw new Error(dev.reason);
  assert.deepEqual([dev.criteria.environment, dev.criteria.summary, dev.criteria.from.toISOString()], ['dev', true, '2026-11-01T17:30:00.000Z']);
  const iso = parseJourneyArgs(['--correlacao', 'c-1', '--desde', '2026-11-01T10:00:00Z', '--ate', '2026-11-01T11:00:00Z'], NOW);
  assert.equal(iso.ok, true);
  assert.equal(parseJourneyArgs([], NOW).ok, false);
  assert.equal(parseJourneyArgs(['--usuario', 'a', '--sessao', 'b'], NOW).ok, false);
  assert.equal(parseJourneyArgs(['--sessao', 'tem espaço'], NOW).ok, false);
  assert.equal(parseJourneyArgs(['--usuario', 'a', '--desde', '40d'], NOW).ok, false);
  assert.equal(parseJourneyArgs(['--usuario', 'a', '--desde', '1h', '--ate', '2h'], NOW).ok, false);
  assert.equal(parseJourneyArgs(['--usuario', 'a', '--env', 'qa'], NOW).ok, false);
  assert.equal(parseJourneyArgs(['--usuario', 'a', '--limite', '5000'], NOW).ok, false);
  assert.equal(parseJourneyArgs(['--usuario'], NOW).ok, false);
  assert.equal(parseJourneyArgs(['--outra', 'x'], NOW).ok, false);
});

test('audit query is bounded, ordered by @timestamp and matches new and legacy user fields', () => {
  const body = buildAuditQuery(criteria({ value: 'Ma*ria' })) as { size: number; sort: unknown; query: { bool: { filter: Array<Record<string, any>> } } };
  assert.equal(body.size, 500);
  assert.deepEqual(body.sort, [{ '@timestamp': 'asc' }]);
  assert.deepEqual(body.query.bool.filter[0], { range: { '@timestamp': { gte: '2026-11-01T12:00:00.000Z', lte: '2026-11-01T18:00:00.000Z' } } });
  const should = body.query.bool.filter[1]!.bool.should as Array<Record<string, any>>;
  const fields = should.map((clause) => Object.keys(Object.values(clause)[0] as object)[0]);
  assert.deepEqual(fields, ['attributes.user.id', 'attributes.actor.id', 'attributes.userId', 'attributes.actorId', 'attributes.user.email', 'attributes.user.name']);
  assert.deepEqual(should[4], { term: { 'attributes.user.email': { value: 'Ma*ria', case_insensitive: true } } });
  assert.deepEqual(should[5], { wildcard: { 'attributes.user.name': { value: '*Ma\\*ria*', case_insensitive: true } } });
  assert.equal(body.query.bool.filter[1]!.bool.minimum_should_match, 1);
  const session = buildAuditQuery(criteria({ mode: 'sessao', value: 's-1' })) as any;
  assert.deepEqual(session.query.bool.filter[1].bool.should, [{ term: { 'attributes.session.id': 's-1' } }]);
  const correlation = buildAuditQuery(criteria({ mode: 'correlacao', value: 'c-1' })) as any;
  assert.deepEqual(correlation.query.bool.filter[1].bool.should, [{ term: { 'attributes.correlationId': 'c-1' } }, { term: { 'attributes.requestId': 'c-1' } }]);
});

test('traces query uses the correlationId and the trace ids seen in audit, deduplicated and capped', () => {
  const ids = ['0af7651916cd43dd8448eb211c80319c', '0af7651916cd43dd8448eb211c80319c', 'bad id', ...Array.from({ length: 30 }, (_, i) => `abcdef0123${String(i).padStart(4, '0')}`)];
  const body = buildTracesQuery(criteria({ mode: 'correlacao', value: 'c-1' }), ids) as any;
  const should = body.query.bool.filter[1].bool.should;
  assert.deepEqual(should[0], { term: { 'attributes.correlationId': 'c-1' } });
  assert.equal(should[1].terms.trace_id.length, 20);
  assert.equal(should[1].terms.trace_id.includes('bad id'), false);
  assert.equal(buildTracesQuery(criteria({ mode: 'usuario' }), []), undefined);
});

test('normalization reads dotted and nested keys and tolerates missing fields', () => {
  assert.equal(readDotted({ attributes: { 'user.id': 'u1' } }, 'attributes.user.id'), 'u1');
  assert.equal(readDotted({ user: { id: 'u2' } }, 'user.id'), 'u2');
  assert.equal(readDotted({ 'client.geo': { city_name: 'X' } }, 'client.geo.city_name'), 'X');
  const legacy = auditHitToEvent({ '@timestamp': '2026-11-01T13:00:00.000Z', trace_id: 't1', attributes: { 'actor.id': 'a-9', 'event.action': 'http.request.completed', 'http.route': '/api/comandas', 'http.request.method': 'GET', correlationId: 'c-1', metadata: { durationMs: 42 } } });
  assert.equal(legacy?.userId, 'a-9');
  assert.equal(legacy?.durationMs, 42);
  assert.equal(legacy?.correlationId, 'c-1');
  assert.equal(legacy?.sessionId, undefined);
  assert.equal(legacy?.city, undefined);
  const minimal = auditHitToEvent({ '@timestamp': '2026-11-01T13:00:00.000Z' });
  assert.equal(minimal?.action, undefined);
  assert.equal(auditHitToEvent({ attributes: {} }), undefined);
  const span = traceHitToEvent({ '@timestamp': '2026-11-01T13:00:00.100Z', name: 'GET /api/comandas', duration: 15_400_000, trace_id: 't1', attributes: { 'http.response.status_code': 200, 'url.path': '/api/comandas' } });
  assert.deepEqual([span?.durationMs, span?.status, span?.httpRoute, span?.action], [15, 200, '/api/comandas', 'span GET /api/comandas']);
});

const journeyHits = [
  { '@timestamp': '2026-11-01T13:00:00.000Z', attributes: { 'user.id': 'u1', 'user.name': 'Maria Souza', 'user.email': 'maria@example.test', 'user.roles': ['GARCOM'], 'session.id': 's-1', 'event.action': 'ui.page_view', 'ui.route': '/comandas', 'ui.page': 'Comandas', 'client.address': '187.45.120.33', 'client.geo.city_name': 'Florianópolis', 'client.geo.region_name': 'SC', 'user_agent.name': 'Chrome', 'user_agent.os.name': 'Windows' } },
  { '@timestamp': '2026-11-01T13:00:05.000Z', attributes: { 'user.id': 'u1', 'session.id': 's-1', 'event.action': 'ui.search', 'ui.route': '/comandas', 'ui.search.term': 'mesa 4' } },
  { '@timestamp': '2026-11-01T13:00:09.000Z', attributes: { 'user.id': 'u1', 'session.id': 's-1', 'event.action': 'http.request.completed', 'http.route': '/api/comandas/:id', 'http.request.method': 'POST', 'http.response.status_code': 500, 'http.response.duration_ms': 812 } },
  { '@timestamp': '2026-11-01T13:00:10.000Z', attributes: { 'user.id': 'u1', 'session.id': 's-1', 'event.action': 'ui.error', 'ui.route': '/comandas', 'error.message': 'Falha ao salvar' } },
  { '@timestamp': '2026-11-01T12:30:00.000Z', attributes: { 'actor.id': 'u1', 'event.action': 'http.get', 'http.route': '/api/health' } },
];

test('timeline is in Brasília time, grouped by session, with screen, action, detail, status and place', () => {
  const events = journeyHits.map((hit) => auditHitToEvent(hit)!);
  const sessions = groupBySession(events);
  assert.deepEqual(sessions.map((session) => [session.sessionId, session.events.length]), [['(sem session.id)', 1], ['s-1', 4]]);
  const text = formatTimeline({ criteria: criteria(), events, auditTotal: 5, traceCount: 0 });
  assert.match(text, /^Jornada \(PRD\) — critério usuario=maria/);
  assert.match(text, /Quem: Maria Souza <maria@example\.test> \(id u1\) papel GARCOM/);
  assert.match(text, /== Sessão s-1 — 01\/11\/2026 10:00:00 a 10:00:10 \(4 eventos\) — Chrome\/Windows ==/);
  assert.match(text, /10:00:00 +\/comandas +ui\.page_view +Comandas +— +Florianópolis\/SC · 187\.45\.120\.33/);
  assert.match(text, /busca: "mesa 4"/);
  assert.match(text, /POST \/api\/comandas\/:id +http\.request\.completed +— +500 · 812 ms/);
  assert.match(text, /Erros na sessão: 2 \(último 10:00:10: erro: Falha ao salvar\)/);
  assert.match(text, /Último passo: 10:00:10 em \/comandas \(ui\.error\)/);
  assert.match(text, /09:30:00 +GET|09:30:00 +\/api\/health/);
});

test('timeline handles no events and truncated results', () => {
  assert.match(formatTimeline({ criteria: criteria(), events: [], auditTotal: 0, traceCount: 0 }), /Nenhum evento encontrado/);
  const events = journeyHits.slice(0, 2).map((hit) => auditHitToEvent(hit)!);
  assert.match(formatTimeline({ criteria: criteria(), events, auditTotal: 900, traceCount: 0 }), /auditoria 2 de 900, truncado em --limite/);
});

test('summary prompt is short and in Portuguese; LLM failure or non-loopback endpoint degrades to undefined', async () => {
  const prompt = buildSummaryPrompt('x'.repeat(20_000));
  assert.match(prompt.system, /quem .* o quê .* onde .* erros e onde travou/);
  assert.ok(prompt.user.length < 12_200);
  const config = { endpoint: 'http://127.0.0.1:11434', model: 'gemma', timeoutMs: 1000, numCtx: 4096 };
  assert.equal(await summarizeJourney('t', config, async () => { throw new TypeError('fetch failed'); }), undefined);
  assert.equal(await summarizeJourney('t', config, async () => new Response('{}', { status: 500 })), undefined);
  assert.equal(await summarizeJourney('t', { ...config, endpoint: 'http://192.168.0.10:11434' }, async () => new Response(JSON.stringify({ message: { content: 'x' } }))), undefined);
  let body: any;
  const ok = await summarizeJourney('t', config, async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ message: { content: ' Maria abriu comandas e travou ao salvar. ' } })); });
  assert.equal(ok, 'Maria abriu comandas e travou ao salvar.');
  assert.equal(body.stream, false);
  assert.equal(body.format, undefined);
});

test('journey files older than 30 days are removed; recent and foreign files stay', () => withDir(async (dir) => {
  const old = join(dir, 'jornada-prd-usuario-20260901-100000-aaaaaaaa.txt');
  const recent = join(dir, 'jornada-prd-sessao-20261031-100000-bbbbbbbb.txt');
  const foreign = join(dir, 'notas.txt');
  for (const path of [old, recent, foreign]) await writeFile(path, 'x');
  const day = 86_400_000;
  await utimes(old, new Date(NOW.getTime() - 31 * day), new Date(NOW.getTime() - 31 * day));
  await utimes(recent, new Date(NOW.getTime() - 29 * day), new Date(NOW.getTime() - 29 * day));
  await utimes(foreign, new Date(NOW.getTime() - 90 * day), new Date(NOW.getTime() - 90 * day));
  assert.equal(await cleanupJourneys(dir, NOW), 1);
  assert.deepEqual((await readdir(dir)).sort(), ['jornada-prd-sessao-20261031-100000-bbbbbbbb.txt', 'notas.txt']);
  assert.equal(await cleanupJourneys(join(dir, 'nao-existe'), NOW), 0);
}));

test('file names carry no personal data', () => {
  const name = journeyFileName({ environment: 'prd', mode: 'usuario', value: 'maria@example.test' }, NOW);
  assert.match(name, /^jornada-prd-usuario-20261101-180000-[0-9a-f]{8}\.txt$/);
  assert.equal(name.includes('maria'), false);
});

test('env file parser handles comments and quotes', () => {
  assert.deepEqual(parseEnvFile('# c\nSUPPORT_ANALYST_ENV=dev\nSUPPORT_ANALYST_ES_URL="http://localhost:9200"\n\nBROKEN\n'), { SUPPORT_ANALYST_ENV: 'dev', SUPPORT_ANALYST_ES_URL: 'http://localhost:9200' });
});

test('runJourney: DEV end to end with fake Elastic, saves the file and degrades without LLM', () => withDir(async (dir) => {
  const calls: Array<{ index: string; body: any }> = [];
  const output: string[] = [];
  const code = await runJourney(['--correlacao', 'c-1', '--env', 'dev', '--resumo'], {
    env: { ELASTIC_PASSWORD: 'nao-deve-vazar' },
    now: () => NOW,
    out: (text) => output.push(text),
    err: (text) => output.push(text),
    journeyDir: dir,
    loadEnvFile: async () => ({ SUPPORT_ANALYST_ENV: 'dev', SUPPORT_ANALYST_ES_URL: 'http://localhost:9200', SUPPORT_ANALYST_ES_API_KEY: 'k' }),
    sources: () => ({
      indexNames: () => ({ audit: 'logs-audit*.otel-dev*', traces: 'traces-*.otel-dev*' }),
      searchRaw: async (index, body) => {
        calls.push({ index, body });
        if (index.startsWith('logs-audit')) return { hits: { total: { value: 1 }, hits: [{ _source: { '@timestamp': '2026-11-01T13:00:00.000Z', trace_id: '0af7651916cd43dd8448eb211c80319c', attributes: { 'event.action': 'http.post', 'http.route': '/api/comandas', correlationId: 'c-1' } } }] } };
        return { hits: { total: { value: 1 }, hits: [{ _source: { '@timestamp': '2026-11-01T13:00:00.050Z', name: 'POST', duration: 9_000_000, trace_id: '0af7651916cd43dd8448eb211c80319c', attributes: { 'http.response.status_code': 201 } } }] } };
      },
    }),
    summarize: async () => undefined,
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.index), ['logs-audit*.otel-dev*', 'traces-*.otel-dev*']);
  const all = output.join('');
  assert.match(all, /traces 1/);
  assert.match(all, /Resumo indisponível/);
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  assert.match(await readFile(join(dir, files[0]!), 'utf8'), /Jornada \(DEV\)/);
}));

test('runJourney: PRD without the three markers is refused before any query', async () => {
  let queried = false;
  const errors: string[] = [];
  const code = await runJourney(['--usuario', 'u1', '--env', 'prd'], {
    env: {}, now: () => NOW, out: () => undefined, err: (text) => errors.push(text), journeyDir: tmpdir(),
    loadEnvFile: async () => ({ SUPPORT_ANALYST_ENV: 'prd', SUPPORT_ANALYST_ES_URL: 'https://elastic-prd.internal:9200', SUPPORT_ANALYST_ES_API_KEY: 'k' }),
    sources: () => ({ indexNames: () => ({ audit: 'a', traces: 't' }), searchRaw: async () => { queried = true; return {}; } }),
  });
  assert.equal(code, 2);
  assert.equal(queried, false);
  assert.match(errors.join(''), /SUPPORT_ANALYST_ALLOW_PRD=true/);
});

test('runJourney: missing credential file and bad arguments exit with 2', async () => {
  const errors: string[] = [];
  assert.equal(await runJourney(['--usuario', 'u1', '--env', 'dev'], { env: {}, now: () => NOW, out: () => undefined, err: (text) => errors.push(text), loadEnvFile: async () => undefined }), 2);
  assert.match(errors.join(''), /support-analyst-dev\.env/);
  assert.equal(await runJourney(['--nada'], { env: {}, now: () => NOW, out: () => undefined, err: () => undefined }), 2);
});
