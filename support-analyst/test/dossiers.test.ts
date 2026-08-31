import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ContextBuilder, buildDeterministicDossier, DossierStore, FeedbackStore, renderDossierMarkdown } from '../src/dossiers/index.js';
import { IncidentGrouper, emptyHealth, recordDossierHealth } from '../src/incidents/index.js';
import type { Incident, NormalizedEvent } from '../src/types.js';

const generatedAt = '2026-08-31T12:04:00.000Z';
function event(id: string, timestamp: string, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { schemaVersion: 1, eventId: id, timestamp, source: 'technical', eventType: 'db.connection.failed', service: 'quiver-api', releaseSha: 'r1', tenantId: 'tenant-a', http: { route: '/api/comandas', statusCode: 500 }, db: { category: 'CONNECTION' }, rawRef: { index: 'synthetic', id }, ...extra };
}
function incident(events: readonly NormalizedEvent[]): Incident { const grouped = new IncidentGrouper().group({ events, relations: [], existingIncidents: [], referenceTime: generatedAt }); assert.equal(grouped.incidents.length, 1); return grouped.incidents[0]!; }
function dossier(events: readonly NormalizedEvent[] = [event('a', '2026-08-31T12:00:00.000Z'), event('b', '2026-08-31T12:03:00.000Z')]) { const built = new ContextBuilder().build({ incident: incident(events), events, relations: [] }); return buildDeterministicDossier({ context: built, generatedAt }); }

test('ContextBuilder limits and orders timeline deterministically while recording truncation', () => {
  const events = Array.from({ length: 45 }, (_value, index) => event(`e-${String(index).padStart(2, '0')}`, `2026-08-31T12:${String(index).padStart(2, '0')}:00.000Z`));
  const input = { incident: incident(events), events: [...events].reverse(), relations: [] };
  const first = new ContextBuilder().build(input); const second = new ContextBuilder().build({ ...input, events });
  assert.equal(first.timeline.length, 40); assert.deepEqual(first.timeline, second.timeline);
  assert.deepEqual(first.contextStats, { totalEvents: 45, selectedEvents: 40, contextTruncated: true });
  assert.ok(first.timeline.every((item, index, values) => index === 0 || `${values[index - 1]!.timestamp}:${values[index - 1]!.eventId}` <= `${item.timestamp}:${item.eventId}`));
});

test('Dossier facts are evidence-backed, factual, and do not claim commercial tenant impact', () => {
  const result = dossier();
  assert.ok(result.facts.length > 0 && result.facts.every((fact) => fact.evidenceRefs.length > 0));
  assert.ok(result.facts.some((fact) => fact.type === 'OCCURRENCE_COUNT' && /2 ocorrência/.test(fact.statement)));
  assert.ok(result.facts.some((fact) => fact.type === 'TENANT_IMPACT' && /tenant\(s\) técnico/.test(fact.statement)));
  assert.ok(!JSON.stringify(result).includes('clientes impactados'));
  assert.ok(result.evidence.every((item) => item.rawRef.index && item.rawRef.id));
});

test('Dossier context hash and ID ignore generatedAt, while deterministic output is reproducible', () => {
  const context = new ContextBuilder().build({ incident: incident([event('a', '2026-08-31T12:00:00.000Z')]), events: [event('a', '2026-08-31T12:00:00.000Z')], relations: [] });
  const a = buildDeterministicDossier({ context, generatedAt });
  const b = buildDeterministicDossier({ context, generatedAt: '2026-08-31T12:05:00.000Z' });
  assert.equal(a.contextHash, b.contextHash); assert.equal(a.dossierId, b.dossierId); assert.notEqual(a.generatedAt, b.generatedAt);
});

test('hypotheses are conditional and checks are investigative rather than remediation', () => {
  const result = dossier(); const text = JSON.stringify(result);
  assert.match(result.hypotheses[0]!.statement, /pode estar contribuindo/i);
  assert.doesNotMatch(text, /caused by|root cause is|causou|causa raiz|vulnerabilidade encontrada/i);
  assert.doesNotMatch(result.recommendedChecks.map((item) => item.statement).join(' '), /deploy|rollback|restart|migration|DELETE|UPDATE|kill|stop-service|start-service/i);
});

test('unknown input produces an explicit evidence gap and no invented specific hypothesis', () => {
  const unknown = event('unknown', '2026-08-31T12:00:00.000Z', { eventType: 'unmapped.signal', db: undefined, http: undefined, tenantId: undefined, releaseSha: undefined, service: undefined });
  const result = dossier([unknown]);
  assert.equal(result.class, 'UNKNOWN');
  assert.match(result.hypotheses[0]!.statement, /Não há evidência suficiente/i);
  assert.ok(result.gaps.some((gap) => /Nenhuma release|Nenhum tenant|LOW/.test(gap.statement)));
});

test('relations, source failures, normalization failures, and absent release become explicit safe context', () => {
  const first = event('one', '2026-08-31T12:00:00.000Z', { releaseSha: undefined });
  const second = event('two', '2026-08-31T12:01:00.000Z', { releaseSha: undefined, actorId: 'excluded' });
  const relation = { anchorEventId: 'one', relatedEventId: 'two', level: 'DETERMINISTIC' as const, reasons: [{ code: 'SAME_CORRELATION_ID' as const }] };
  const context = new ContextBuilder().build({ incident: incident([first, second]), events: [second, first], relations: [relation], sourceFailures: [{ source: 'audit', kind: 'timeout' }], normalizationSummary: { accepted: 2, rejected: 1, rejectedReasons: ['missing_timestamp'] } });
  const result = buildDeterministicDossier({ context, generatedAt });
  assert.ok(result.evidence.every((item) => item.relationLevel === 'DETERMINISTIC'));
  assert.ok(result.evidence.every((item) => item.relationReasons?.[0]?.code === 'SAME_CORRELATION_ID'));
  assert.ok(result.gaps.some((gap) => /fonte audit informou falha timeout/.test(gap.statement)));
  assert.ok(result.gaps.some((gap) => /rejeitados na normalização/.test(gap.statement)));
  assert.ok(result.gaps.some((gap) => /Nenhuma release/.test(gap.statement)));
  assert.doesNotMatch(JSON.stringify(result), /actorId|excluded/i);
});

test('DossierStore writes matching immutable JSON and Markdown snapshots', async () => {
  const runtime = await mkdtemp(join(tmpdir(), 'analyst-dossier-'));
  try {
    const result = dossier(); const store = new DossierStore(runtime);
    assert.equal((await store.save(result)).dossierId, result.dossierId);
    assert.equal((await store.save({ ...result, generatedAt: '2026-08-31T12:05:00.000Z' })).generatedAt, result.generatedAt);
    const paths = store.dossierPaths(result.incidentId, result.dossierId);
    assert.deepEqual(JSON.parse(await readFile(paths.json, 'utf8')), result);
    assert.equal(await readFile(paths.markdown, 'utf8'), renderDossierMarkdown(result));
    await assert.rejects(() => store.save({ ...result, severity: 'SEV1' }), /different content/);
  } finally { await rm(runtime, { recursive: true, force: true }); }
});

test('Dossier privacy boundary and Markdown escaping omit prohibited data and structure injection', () => {
  const malicious = event('safe', '2026-08-31T12:00:00.000Z', { eventType: '# heading <script>alert(1)</script>', action: 'token=secret-value', actorId: 'person@example.com', error: { message: 'Authorization: Bearer secret-value' } });
  const result = dossier([malicious]); const markdown = renderDossierMarkdown(result);
  assert.doesNotMatch(JSON.stringify(result), /actorId|person@example\.com|Authorization|Bearer|secret-value|stack|bindings/i);
  assert.doesNotMatch(markdown, /<script>|^# heading/m);
});

test('FeedbackStore is append-only, validates dossier existence, and stores no reviewer identity', async () => {
  const runtime = await mkdtemp(join(tmpdir(), 'analyst-feedback-'));
  try {
    const result = dossier(); const dossiers = new DossierStore(runtime); await dossiers.save(result);
    const feedbacks = new FeedbackStore(runtime);
    const recorded = await feedbacks.append({ dossierId: result.dossierId, createdAt: generatedAt, rating: 'PARTIAL', flags: ['MISSING_CONTEXT'], comment: 'token=do-not-persist' }, (id) => dossiers.exists(id));
    assert.equal(recorded.rating, 'PARTIAL'); assert.equal(recorded.comment, '[REDACTED]');
    assert.equal((await feedbacks.list()).length, 1);
    await assert.rejects(() => feedbacks.append({ dossierId: 'missing', createdAt: generatedAt, rating: 'USEFUL' }, (id) => dossiers.exists(id)), /existing dossier/);
    assert.doesNotMatch(await readFile(join(runtime, 'feedback.jsonl'), 'utf8'), /reviewer|email|do-not-persist/i);
  } finally { await rm(runtime, { recursive: true, force: true }); }
});

test('dossier health extension only records local counters', () => {
  const health = recordDossierHealth(emptyHealth(), { dossierGenerated: true, feedbackRecorded: true });
  assert.equal(health.dossiersGenerated, 1); assert.equal(health.feedbackRecorded, 1);
  assert.equal(health.dossierFailures, 0); assert.equal(health.feedbackFailures, 0);
});
