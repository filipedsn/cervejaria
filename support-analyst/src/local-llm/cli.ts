import { readLocalLlmConfig } from '../config.js';
import { buildSyntheticScenarios } from '../llm-benchmark/runner.js';
import { LocalLlmAnalyzer } from './analyzer.js';
import { getModelInfo } from './client.js';
import { EnrichmentStore, InteractionStore } from './store.js';

const parsed = readLocalLlmConfig(process.env);
if (!parsed.ok) throw new Error(parsed.reason);
const runtimeDir = process.env.SUPPORT_ANALYST_RUNTIME_DIR;
const command = process.argv[2];
if (command === '--status') {
  try {
    const model = await getModelInfo(parsed.config.endpoint, parsed.config.model);
    console.log(JSON.stringify({ enabled: parsed.config.enabled, endpoint: 'loopback', model: parsed.config.model, available: Boolean(model), digest: model?.digest, quantization: model?.quantization }, null, 2));
  } catch { console.log(JSON.stringify({ enabled: parsed.config.enabled, endpoint: 'loopback', model: parsed.config.model, available: false, status: 'OLLAMA_UNAVAILABLE' }, null, 2)); process.exitCode = 1; }
} else if (command === '--smoke') {
  if (!runtimeDir) throw new Error('SUPPORT_ANALYST_RUNTIME_DIR is required for LLM interaction persistence.');
  if (!parsed.config.enabled) throw new Error('SUPPORT_ANALYST_LLM_ENABLED=true is required for the explicit smoke command.');
  const scenario = buildSyntheticScenarios().find((item) => item.name === 'DATABASE_FAILURE');
  if (!scenario) throw new Error('Synthetic DATABASE_FAILURE fixture is unavailable.');
  const analyzer = new LocalLlmAnalyzer(parsed.config, { record: (row) => new InteractionStore(runtimeDir).append(row), saveEnrichment: (row) => new EnrichmentStore(runtimeDir).save(row) });
  const result = await analyzer.analyze({ dossier: scenario.dossier, generatedAt: new Date().toISOString() });
  console.log(JSON.stringify({ status: result.status, reason: result.status === 'FALLBACK' ? result.reason : undefined, interactionId: result.interactionId, enrichmentId: result.status === 'ENRICHED' ? result.enrichmentId : undefined, executiveSummary: result.status === 'ENRICHED' ? result.analysis.executiveSummary : undefined, counters: analyzer.healthCounters() }, null, 2));
  if (result.status !== 'ENRICHED') process.exitCode = 1;
} else throw new Error('Use --status or --smoke.');
