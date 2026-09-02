import { readHealthConfig } from '../config.js';
import { checkExternalHealth } from './checker.js';
const config = readHealthConfig(process.env);
if (!config.ok) { console.error(`Configuration invalid: ${config.reason}`); process.exitCode = 3; }
else {
  const result = await checkExternalHealth(process.env.SUPPORT_ANALYST_RUNTIME_DIR, config.config);
  if (process.argv.includes('--json')) console.log(JSON.stringify(result.snapshot ?? { overall: result.status, reasons: result.reasons }, null, 2));
  else { const s = result.snapshot; console.log(`Overall: ${result.status}\n`); if (s) { console.log(`Process: ${s.process.status}\nElastic: ${s.elastic.status}\nProcessing: ${s.processing.status}\nLLM: ${s.llm.status}\nQuality: ${s.quality.status}`); } if (result.reasons.length) console.log(`\nReasons:\n${result.reasons.map((reason) => `- ${reason}`).join('\n')}`); }
  process.exitCode = result.exitCode;
}
