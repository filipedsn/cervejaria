import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readAnalystConfig, readLocalLlmConfig, requireRuntimeElasticsearchConfig } from '../config.js';
import { ElasticsearchSources } from '../sources/index.js';
import { sanitizeFreeText } from '../privacy/sanitize.js';
import { JOURNEY_USAGE, parseJourneyArgs } from './args.js';
import { formatTimeline } from './format.js';
import { auditHitToEvent, hitsOf, traceHitToEvent } from './normalize.js';
import { buildAuditQuery, buildTracesQuery } from './query.js';
import { cleanupJourneys, defaultJourneyDir, journeyFileName, repositoryRoot, saveJourney } from './store.js';
import { summarizeJourney } from './summary.js';
import type { JourneyEvent } from './types.js';

type Env = Record<string, string | undefined>;
export type JourneySearch = { indexNames(): { audit: string; traces: string }; searchRaw(index: string, body: unknown): Promise<unknown> };
export type JourneyDependencies = {
  env: Env;
  now?: () => Date;
  out?: (text: string) => void;
  err?: (text: string) => void;
  journeyDir?: string;
  loadEnvFile?: (environment: 'dev' | 'prd') => Promise<Env | undefined>;
  sources?: (env: Env) => JourneySearch;
  summarize?: (timeline: string, env: Env) => Promise<string | undefined>;
};

/** Parses KEY=VALUE lines (same rules as run-analyst.ps1). Values are never printed. */
export function parseEnvFile(content: string): Env {
  const env: Env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0]!)) value = value.slice(1, -1);
    env[trimmed.slice(0, eq).trim()] = value;
  }
  return env;
}

async function defaultLoadEnvFile(environment: 'dev' | 'prd'): Promise<Env | undefined> {
  try { return parseEnvFile(await readFile(join(repositoryRoot(), 'deploy', 'runtime', `support-analyst-${environment}.env`), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Only SUPPORT_ANALYST_* variables reach the config: the analyst refuses privileged credentials. */
function analystOnly(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith('SUPPORT_ANALYST_')));
}

export async function runJourney(args: string[], deps: JourneyDependencies): Promise<number> {
  const out = deps.out ?? ((text: string) => process.stdout.write(text));
  const err = deps.err ?? ((text: string) => process.stderr.write(text));
  const now = deps.now?.() ?? new Date();
  if (args.includes('--help')) { out(`${JOURNEY_USAGE}\n`); return 0; }
  const defaultEnvironment = deps.env.SUPPORT_ANALYST_ENV === 'dev' ? 'dev' : 'prd';
  const parsed = parseJourneyArgs(args, now, defaultEnvironment);
  if (!parsed.ok) { err(`jornada: ${parsed.reason}\n\n${JOURNEY_USAGE}\n`); return 2; }
  const criteria = parsed.criteria;

  let env = analystOnly(deps.env);
  if (env.SUPPORT_ANALYST_ENV !== criteria.environment || !env.SUPPORT_ANALYST_ES_API_KEY) {
    const fromFile = await (deps.loadEnvFile ?? defaultLoadEnvFile)(criteria.environment);
    if (!fromFile) { err(`jornada: credencial ausente; crie deploy/runtime/support-analyst-${criteria.environment}.env (ver docs/support-analyst/TQ-SA-PILOT-01-runbook.md)\n`); return 2; }
    const llmOverrides = Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith('SUPPORT_ANALYST_LLM_')));
    env = { ...llmOverrides, ...analystOnly(fromFile) };
  }
  if (env.SUPPORT_ANALYST_ENV !== criteria.environment) { err(`jornada: SUPPORT_ANALYST_ENV do arquivo difere de --env ${criteria.environment}\n`); return 2; }
  const analyst = readAnalystConfig(env);
  const runtime = analyst.ok ? requireRuntimeElasticsearchConfig(analyst.config, env) : analyst;
  if (!runtime.ok) { err(`jornada: configuração inválida: ${runtime.reason}\n`); return 2; }

  const sources = deps.sources ? deps.sources(env) : ElasticsearchSources.fromConfig(runtime.config, env);
  const indices = sources.indexNames();
  const events: JourneyEvent[] = [];
  let auditTotal = 0;
  let traceCount = 0;
  try {
    const audit = hitsOf(await sources.searchRaw(indices.audit, buildAuditQuery(criteria)));
    auditTotal = audit.total;
    for (const source of audit.sources) { const event = auditHitToEvent(source); if (event) events.push(event); }
    const tracesQuery = criteria.mode === 'correlacao' ? buildTracesQuery(criteria, events.map((event) => event.traceId ?? '')) : undefined;
    if (tracesQuery) {
      try {
        const traces = hitsOf(await sources.searchRaw(indices.traces, tracesQuery));
        for (const source of traces.sources) { const event = traceHitToEvent(source); if (event) { events.push(event); traceCount += 1; } }
      } catch { err('jornada: traces indisponíveis; seguindo só com a auditoria\n'); }
    }
  } catch (error) {
    err(`jornada: falha ao consultar o Elastic ${criteria.environment.toUpperCase()}: ${sanitizeFreeText(error instanceof Error ? error.message : String(error), 300)}\n`);
    return 1;
  }

  let text = formatTimeline({ criteria, events, auditTotal, traceCount });
  if (criteria.summary) {
    const summary = events.length ? await (deps.summarize ?? defaultSummarize)(text, env) : undefined;
    text += summary
      ? `\n--- Resumo (LLM local) ---\n${summary}\n`
      : '\n--- Resumo indisponível (LLM local não respondeu ou não há eventos); segue só a linha do tempo ---\n';
  }
  out(text);
  const dir = deps.journeyDir ?? defaultJourneyDir();
  const removed = await cleanupJourneys(dir, now);
  const path = await saveJourney(dir, journeyFileName(criteria, now), text);
  out(`\nArquivo: ${path}\nArquivos de jornada removidos (> 30 dias): ${removed}\n`);
  return 0;
}

async function defaultSummarize(timeline: string, env: Env): Promise<string | undefined> {
  const llm = readLocalLlmConfig(env);
  if (!llm.ok) return undefined;
  return summarizeJourney(timeline, llm.config);
}
