import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readAnalystConfig } from './config.js';
import { normalizeEvent } from './normalize/index.js';
import { ElasticsearchSources } from './sources/index.js';
import { normalizeBatch } from './sources/pipeline.js';
import type { RawEventDocument } from './types.js';

const help = `Support Analyst core (TQ-SA-03)

Usage:
  support-analyst --help
  support-analyst --validate-config
  support-analyst --normalize-fixture <file>

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
export type * from './types.js';
