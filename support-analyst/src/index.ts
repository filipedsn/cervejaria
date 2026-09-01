import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readAnalystConfig } from './config.js';
import { normalizeEvent } from './normalize/index.js';
import { ElasticsearchSources } from './sources/index.js';
import { normalizeBatch } from './sources/pipeline.js';
import { IncidentGrouper } from './incidents/grouper.js';
import { ContextBuilder, buildDeterministicDossier, DossierStore, FeedbackStore, renderDossierMarkdown } from './dossiers/index.js';
import type { NormalizedEvent, RawEventDocument } from './types.js';

const help = `Support Analyst core (TQ-SA-03)

Usage:
  support-analyst --help
  support-analyst --validate-config
  support-analyst --normalize-fixture <file>
  support-analyst --incident-replay
  support-analyst --dossier-replay [--show-markdown]
  support-analyst --feedback <dossierId> <USEFUL|PARTIAL|WRONG> --created-at <ISO> [--flags A,B] [--comment <text>]

  support-analyst --dev-smoke

The dev smoke is read-only, requires DEV credentials, and prints only counts.`;

async function main(args: string[]): Promise<number> {
  const [command, file] = args;
  if (!command) {
    console.log('Support Analyst core initialized. Runtime Elasticsearch source not implemented in TQ-SA-03.');
    return 0;
  }
  if (command === '--help') {
    console.log(help);
    return 0;
  }
  if (command === '--validate-config') {
    const result = readAnalystConfig(process.env);
    console.log(result.ok ? 'Support Analyst configuration is structurally valid.' : `Configuration invalid: ${result.reason}`);
    return result.ok ? 0 : 2;
  }
  if (command === '--normalize-fixture' && file) {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as RawEventDocument;
      const result = normalizeEvent(raw);
      if (!result.ok) {
        console.error(`Normalization failed: ${result.reason}`);
        return 1;
      }
      console.log(JSON.stringify(result.event, null, 2));
      return 0;
    } catch {
      console.error('Unable to read a valid JSON fixture.');
      return 2;
    }
  }
  if (command === '--dev-smoke') {
    const parsed = readAnalystConfig(process.env);
    if (!parsed.ok) { console.error(`Configuration invalid: ${parsed.reason}`); return 2; }
    try {
      const sources = ElasticsearchSources.fromConfig(parsed.config, process.env);
      const now = Date.now();
      const range = { from: new Date(now - 24 * 60 * 60_000).toISOString(), to: new Date(now).toISOString() };
      const [alerts, audit, technical] = await Promise.all([sources.findAlertEvents({ range, limit: 3 }), sources.findAuditAround({ timestamp: range.to, windowMinutes: 15, limit: 3 }), sources.findTechnicalAround({ timestamp: range.to, windowMinutes: 15, limit: 3 })]);
      const correlationId = process.env.SUPPORT_ANALYST_TEST_CORRELATION_ID;
      const exact = correlationId ? await sources.findByCorrelationId(correlationId, { range, limit: 3 }) : [];
      const normalized = normalizeBatch([...alerts, ...audit, ...technical, ...exact]);
      console.log(JSON.stringify({ environment: 'dev', readOnly: true, alerts: alerts.length, audit: audit.length, technical: technical.length, exactCorrelationLookup: correlationId ? exact.length : 'not_requested', normalization: { received: normalized.received, normalized: normalized.normalized, rejected: normalized.rejected, rejectedReasons: normalized.rejectedReasons } }));
      return 0;
    } catch (error) { console.error(error instanceof Error ? error.message : 'DEV smoke failed'); return 1; }
  }
  if (command === '--incident-replay') {
    let fixture: readonly NormalizedEvent[];
    try { fixture = JSON.parse(await readFile(new URL('../test/fixtures/incident-replay.json', import.meta.url), 'utf8')) as NormalizedEvent[]; }
    catch { console.error('Unable to read the synthetic incident replay fixture.'); return 2; }
    const result = new IncidentGrouper().group({ events: fixture, relations: [], existingIncidents: [], referenceTime: '2026-08-31T12:04:00.000Z' });
    console.log(JSON.stringify(result.incidents.map((incident) => ({ class: incident.class, severity: incident.severity, confidence: incident.confidence, occurrences: incident.occurrences })), null, 2));
    return 0;
  }
  if (command === '--dossier-replay') {
    let fixture: readonly NormalizedEvent[];
    try { fixture = JSON.parse(await readFile(new URL('../test/fixtures/incident-replay.json', import.meta.url), 'utf8')) as NormalizedEvent[]; }
    catch { console.error('Unable to read the synthetic dossier replay fixture.'); return 2; }
    const grouped = new IncidentGrouper().group({ events: fixture, relations: [], existingIncidents: [], referenceTime: '2026-08-31T12:04:00.000Z' });
    const incident = grouped.incidents[0];
    if (!incident) { console.error('Dossier replay did not create an incident.'); return 1; }
    const context = new ContextBuilder().build({ incident, events: fixture, relations: [] });
    const dossier = buildDeterministicDossier({ context, generatedAt: '2026-08-31T12:04:00.000Z' });
    console.log(JSON.stringify({ dossierId: dossier.dossierId, class: dossier.class, severity: dossier.severity, confidence: dossier.confidence, factCount: dossier.facts.length, evidenceCount: dossier.evidence.length, hypothesisCount: dossier.hypotheses.length, gapCount: dossier.gaps.length, recommendedCheckCount: dossier.recommendedChecks.length, contextHash: dossier.contextHash }, null, 2));
    if (args.includes('--show-markdown')) console.log(renderDossierMarkdown(dossier));
    return 0;
  }
  if (command === '--feedback') {
    const dossierId = file;
    const rating = args[2] as 'USEFUL' | 'PARTIAL' | 'WRONG' | undefined;
    const createdAtIndex = args.indexOf('--created-at');
    const flagsIndex = args.indexOf('--flags');
    const commentIndex = args.indexOf('--comment');
    const createdAt = createdAtIndex >= 0 ? args[createdAtIndex + 1] : undefined;
    const runtimeDir = process.env.SUPPORT_ANALYST_RUNTIME_DIR;
    if (!dossierId || !rating || !createdAt || !runtimeDir) { console.error('Feedback requires dossierId, rating, --created-at, and SUPPORT_ANALYST_RUNTIME_DIR.'); return 2; }
    try {
      const dossiers = new DossierStore(runtimeDir);
      const feedback = await new FeedbackStore(runtimeDir).append({ dossierId, rating, createdAt, flags: flagsIndex >= 0 && args[flagsIndex + 1] ? args[flagsIndex + 1].split(',') as never[] : [], comment: commentIndex >= 0 ? args[commentIndex + 1] : undefined }, (id) => dossiers.exists(id));
      console.log(JSON.stringify({ feedbackId: feedback.feedbackId, dossierId: feedback.dossierId, rating: feedback.rating }, null, 2));
      return 0;
    } catch (error) { console.error(error instanceof Error ? error.message : 'Unable to record feedback.'); return 1; }
  }
  console.error('Unsupported command. Use --help.');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

export * from './config.js';
export * from './normalize/index.js';
export * from './privacy/sanitize.js';
export * from './correlation.js';
export * from './sources/index.js';
export * from './sources/pipeline.js';
export * from './incidents/index.js';
export * from './dossiers/index.js';
export * from './local-llm/index.js';
export type * from './types.js';
