import { CANDIDATES } from './types.js';
import { FINALIST_SCENARIOS, QUALIFICATION_SCENARIOS, runBenchmark } from './runner.js';

const runtimeDir = process.env.SUPPORT_ANALYST_RUNTIME_DIR;
if (!runtimeDir) throw new Error('SUPPORT_ANALYST_RUNTIME_DIR is required for benchmark persistence.');
const finalist = process.env.SUPPORT_ANALYST_BENCHMARK_STAGE === 'finalist';
const result = await runBenchmark({ runtimeDir, endpoint: process.env.SUPPORT_ANALYST_OLLAMA_URL ?? 'http://127.0.0.1:11434', models: CANDIDATES, scenarios: finalist ? FINALIST_SCENARIOS : QUALIFICATION_SCENARIOS, repetitions: finalist ? 2 : 1 });
console.log(JSON.stringify({ runId: result.runId, interactions: result.interactions.length, directory: result.directory }, null, 2));
