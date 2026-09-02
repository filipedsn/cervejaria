import { readHealthConfig, readLocalLlmConfig } from '../config.js';
import { HealthStore } from './store.js';
import { HealthTracker } from './tracker.js';
const runtimeDir = process.env.SUPPORT_ANALYST_RUNTIME_DIR;
const health = readHealthConfig(process.env); const llm = readLocalLlmConfig(process.env);
if (!runtimeDir) throw new Error('SUPPORT_ANALYST_RUNTIME_DIR is required.');
if (!health.ok) throw new Error(health.reason);
if (!llm.ok) throw new Error(llm.reason);
// Synthetic/local only: no Elastic or Ollama request and no daemon is started.
const tracker = new HealthTracker(new HealthStore(runtimeDir), health.config, llm.config, true);
await tracker.start(); tracker.cycleStarted(); tracker.elasticReadSucceeded(); tracker.cycleCompleted({ eventsRead: 0, eventsNormalized: 0, durationMs: 1 });
console.log(JSON.stringify(tracker.snapshot(), null, 2));
