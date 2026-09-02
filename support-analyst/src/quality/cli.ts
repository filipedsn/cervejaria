import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configFromEnvironment, runQualityEvaluation, summarizeQualityRun } from './runner.js';

const runtimeDir = process.env.SUPPORT_ANALYST_RUNTIME_DIR;
if (!runtimeDir) throw new Error('SUPPORT_ANALYST_RUNTIME_DIR is required for quality artifacts.');
const command = process.argv[2];
if (command === '--run') {
  const gitSha = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() }).then((result) => result.stdout.trim()).catch(() => undefined);
  const started = Date.now(); const result = await runQualityEvaluation({ runtimeDir, config: configFromEnvironment(), gitSha });
  console.log(JSON.stringify({ status: result.run.status, runId: result.run.runId, directory: result.directory, expectedInferenceCount: result.run.scenarioCount * result.run.repeats, actualInferenceCount: result.interactions.length, totalTechnicalRunDurationMs: Date.now() - started }, null, 2));
} else if (command === '--summary') {
  const runId = process.argv[3]; if (!runId) throw new Error('Use --summary <runId>.');
  console.log(JSON.stringify(await summarizeQualityRun(runtimeDir, runId), null, 2));
} else throw new Error('Use --run or --summary <runId>.');
