import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const url = 'http://127.0.0.1:5198';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--configLoader', 'runner', '--host', '127.0.0.1', '--port', '5198', '--strictPort'], { cwd: 'frontend', windowsHide: true, stdio: 'inherit' });
const serverDone = once(server, 'exit');
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Fixture preview exited before readiness');
    try { const response = await fetch(url, { signal: AbortSignal.timeout(500) }); await response.arrayBuffer(); ready = response.ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('Fixture preview failed readiness');
  const runner = spawn(process.execPath, ['node_modules/playwright/cli.js', 'test', '--config=playwright.agenda-ui.config.ts', ...process.argv.slice(2)], { env: { ...process.env, E2E_SKIP_SERVER: '1' }, windowsHide: true, stdio: 'inherit' });
  const [code] = await once(runner, 'exit');
  process.exitCode = code ?? 1;
} finally {
  server.kill();
  await serverDone;
  console.log('AGENDA_UI_PREVIEW_CLEANUP=PASS');
}
