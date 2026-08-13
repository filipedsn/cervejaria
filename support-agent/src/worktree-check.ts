/**
 * Validacao manual da Fase 0.2: cria um worktree descartavel, prova que ele nasce
 * de origin/main, que o repositorio principal nao e tocado, e remove tudo.
 *
 *   npm run worktree:check --prefix support-agent
 */
import { PROJECT_ROOT, config } from './config.js';
import { run, runOrThrow } from './shell.js';
import { assertOutsideProjectRoot, changedPaths, createWorktree, removeWorktree } from './worktree.js';

const SENTINEL_ISSUE = 999999;

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(28)} ${value}`);
}

async function statusFingerprint(): Promise<string> {
  const result = await runOrThrow('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: PROJECT_ROOT,
  });
  return result.stdout;
}

async function main(): Promise<void> {
  console.log('Verificacao de isolamento do worktree (Fase 0.2)\n');

  console.log('1. Guarda contra caminho dentro do repositorio principal');
  let guardWorked = false;
  try {
    assertOutsideProjectRoot(`${PROJECT_ROOT}\\backend`);
  } catch {
    guardWorked = true;
  }
  if (!guardWorked) throw new Error('FALHA: a guarda aceitou um caminho dentro do repo principal.');
  line('caminho interno recusado', 'OK');

  console.log('\n2. Estado do repositorio principal antes');
  const before = await statusFingerprint();
  const headBefore = (await runOrThrow('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT })).stdout.trim();
  const branchBefore = (await runOrThrow('git', ['branch', '--show-current'], { cwd: PROJECT_ROOT })).stdout.trim();
  line('branch', branchBefore);
  line('HEAD', headBefore.slice(0, 12));
  line('arquivos sujos', String(before.split('\n').filter(Boolean).length));

  console.log('\n3. Criando worktree descartavel');
  const wt = await createWorktree(SENTINEL_ISSUE);
  line('diretorio', wt.dir);
  line('branch', wt.branch);
  line('base sha', wt.baseSha.slice(0, 12));

  const mainSha = (
    await runOrThrow('git', ['rev-parse', `origin/${config.github.baseBranch}`], { cwd: PROJECT_ROOT })
  ).stdout.trim();
  if (wt.baseSha !== mainSha) {
    throw new Error(`FALHA: worktree nasceu de ${wt.baseSha}, esperado origin/${config.github.baseBranch} (${mainSha}).`);
  }
  line(`nasceu de origin/${config.github.baseBranch}`, 'OK');

  const dirty = await changedPaths(wt.dir);
  line('worktree limpo', dirty.length === 0 ? 'OK' : `FALHA (${dirty.length} arquivos)`);

  console.log('\n4. Repositorio principal permanece intacto');
  const after = await statusFingerprint();
  const headAfter = (await runOrThrow('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT })).stdout.trim();
  const branchAfter = (await runOrThrow('git', ['branch', '--show-current'], { cwd: PROJECT_ROOT })).stdout.trim();
  if (before !== after) throw new Error('FALHA: o git status do repositorio principal mudou.');
  if (headBefore !== headAfter) throw new Error('FALHA: o HEAD do repositorio principal mudou.');
  if (branchBefore !== branchAfter) throw new Error('FALHA: a branch do repositorio principal mudou.');
  line('git status inalterado', 'OK');
  line('HEAD inalterado', 'OK');
  line('branch inalterada', 'OK');

  console.log('\n5. Limpeza');
  await removeWorktree(wt.dir);
  await run('git', ['branch', '-D', wt.branch], { cwd: PROJECT_ROOT });
  const remaining = (await runOrThrow('git', ['worktree', 'list'], { cwd: PROJECT_ROOT })).stdout;
  if (remaining.includes(`issue-${SENTINEL_ISSUE}`)) throw new Error('FALHA: worktree nao foi removido.');
  line('worktree removido', 'OK');

  console.log('\nIsolamento validado.');
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
