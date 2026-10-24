// Roda localmente os gates de qualidade do Tap Quiver, na ordem do antigo workflow CI.
// GitHub Actions esta desligado (TAP-116); este script e a fonte de verdade do release gate.
// Em sucesso grava deploy/.local-ci-attestation.json com o SHA atual (gitignore).
//
// Neste PC o alert poller de producao executa backend/dist com backend/node_modules da pasta
// principal. Por isso o CI local nao grava backend/dist (checa tipos com --noEmit) e aceita um
// motor Prisma travado apenas se o client ja gerado vier do mesmo schema.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const npx = isWindows ? 'npx.cmd' : 'npx';

function run(command, args, cwd, capture = false) {
  return spawnSync(command, args, {
    cwd: path.join(root, cwd),
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: isWindows,
  });
}

function prismaGenerate() {
  const result = run(npx, ['prisma', 'generate'], 'backend', true);
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.status === 0) return { ok: true };
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const generated = path.join(root, 'backend', 'node_modules', '.prisma', 'client', 'schema.prisma');
  if (!/EPERM/.test(output) || !existsSync(generated)) return { ok: false };

  // O client guarda o schema ja formatado pelo Prisma; compara com a fonte formatada numa copia.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'local-ci-prisma-'));
  try {
    const formatted = path.join(tmp, 'schema.prisma');
    copyFileSync(path.join(root, 'backend', 'prisma', 'schema.prisma'), formatted);
    if (run(npx, ['prisma', 'format', '--schema', formatted], 'backend', true).status !== 0) return { ok: false };
    const normalize = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (normalize(formatted) === normalize(generated)) {
      return { ok: true, note: 'motor Prisma em uso por outro processo; client ja gerado deste schema' };
    }
    console.error('Client Prisma gerado nao corresponde ao schema atual e o motor esta em uso por outro processo.');
    return { ok: false };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const steps = [
  ['frontend', () => run(npm, ['run', 'build'], 'frontend')],
  ['backend-validate: prisma generate', prismaGenerate],
  ['backend-validate: prisma validate', () => run('node', ['scripts/validate-prisma.mjs'], '.')],
  ['backend-test', () => run(npm, ['run', 'test:unit'], 'backend')],
  ['backend-build (tsc --noEmit)', () => run(npx, ['tsc', '--noEmit'], 'backend')],
  ['ops-panel-test', () => run(npm, ['run', 'test:unit'], 'ops-panel')],
  ['observability-tools', () => run('node', ['--test', 'scripts/observability/report-platform.test.mjs', 'scripts/observability/dev-alerts.test.mjs', 'scripts/observability/rebuild-platform.test.mjs'], '.')],
  ['support-analyst-test: typecheck', () => run(npm, ['run', 'typecheck'], 'support-analyst')],
  ['support-analyst-test: test', () => run(npm, ['run', 'test'], 'support-analyst')],
  ['support-analyst-test: dossier-replay', () => run(npm, ['run', 'dossier-replay'], 'support-analyst')],
  ['support-analyst-test: build', () => run(npm, ['run', 'build'], 'support-analyst')],
];

if (isWindows) {
  steps.push(['prod-scripts: boot dependencies', () => run(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Invoke-Pester -Script scripts/prod/boot-dependencies.tests.ps1 -EnableExit'],
    '.',
  )]);
  steps.push(['prod-scripts: release gate', () => run(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Invoke-Pester -Script scripts/prod/release-gate.tests.ps1 -EnableExit'],
    '.',
  )]);
}

const results = [];
for (const [label, step] of steps) {
  console.log(`\n=== ${label} ===`);
  const started = Date.now();
  const outcome = step();
  const ok = 'ok' in outcome ? outcome.ok : outcome.status === 0;
  results.push({ label, ok, note: outcome.note, seconds: Math.round((Date.now() - started) / 1000) });
  if (!ok) break;
}

console.log('\n=== Resumo do CI local ===');
for (const { label, ok, note, seconds } of results) {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label} (${seconds}s)${note ? ` - ${note}` : ''}`);
}
const skipped = steps.length - results.length;
if (skipped > 0) console.log(`${skipped} etapa(s) nao executada(s) apos a falha.`);

const allOk = results.every((r) => r.ok) && skipped === 0;
if (allOk) {
  const rev = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    shell: isWindows,
  });
  const sha = (rev.stdout || '').trim().toLowerCase();
  if (rev.status === 0 && /^[a-f0-9]{40}$/.test(sha)) {
    const attestDir = path.join(root, 'deploy');
    mkdirSync(attestDir, { recursive: true });
    const attestPath = path.join(attestDir, '.local-ci-attestation.json');
    writeFileSync(
      attestPath,
      `${JSON.stringify({
        ok: true,
        sha,
        passedAt: new Date().toISOString(),
        source: 'npm run ci',
        steps: results.map(({ label, seconds }) => ({ label, seconds })),
      }, null, 2)}\n`,
      'utf8',
    );
    console.log(`Atestado de CI local gravado para ${sha.slice(0, 8)} em deploy/.local-ci-attestation.json`);
  } else {
    console.error('CI passou, mas nao foi possivel gravar o atestado (git rev-parse HEAD falhou).');
    process.exit(1);
  }
} else {
  console.log('Sem atestado: corrija as falhas e rode npm run ci de novo antes do deploy.');
}

process.exit(allOk ? 0 : 1);
