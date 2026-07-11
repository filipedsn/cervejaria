import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CLI orchestrator: setup -> suite -> N worker CHILD PROCESSES (true multi-process
// concurrency) -> report. Mirrors the subagent-driven flow for a single command.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKERS = Number(process.env.QA_WORKERS ?? 6);

function run(script: string, env: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('node', ['--import', 'tsx', path.join(__dirname, script)], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      cwd: path.resolve(__dirname, '..'),
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const setup = await run('setup.ts');
  if (setup !== 0) process.exit(setup);

  console.log(`\n[run] Disparando ${WORKERS} workers concorrentes (processos separados)...`);
  const workers = await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => run('worker.ts', { QA_WORKER_ID: String(i + 1) })),
  );
  const suite = await run('suite.ts');

  const failedWorkers = workers.filter((c) => c !== 0).length;
  if (failedWorkers) console.warn(`[run] ${failedWorkers} worker(s) retornaram erro`);
  if (suite !== 0) console.warn('[run] suite retornou erro');

  const report = await run('report.ts');
  process.exit(report);
}

main();
