import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_ROOT, config } from './config.js';
import { run, runOrThrow } from './shell.js';

/**
 * Fase 0.2 — isolamento do working directory.
 *
 * O agente nunca roda no repositorio principal. Cada Issue ganha um worktree novo
 * criado a partir de `origin/main`, fora da arvore do projeto, e descartado no fim.
 */

export type Worktree = {
  dir: string;
  branch: string;
  issueNumber: number;
  baseSha: string;
};

function branchName(issueNumber: number): string {
  return `fix/auto-${issueNumber}`;
}

function worktreeDir(issueNumber: number): string {
  return path.join(config.worktree.root, `issue-${issueNumber}`);
}

/**
 * Guarda contra o pior erro possivel: o agente escrever no repositorio de trabalho
 * do usuario. Qualquer caminho dentro de PROJECT_ROOT e recusado.
 */
export function assertOutsideProjectRoot(dir: string): void {
  const resolved = path.resolve(dir);
  const root = path.resolve(PROJECT_ROOT);
  const relative = path.relative(root, resolved);
  const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (inside) {
    throw new Error(
      `Worktree recusado: ${resolved} esta dentro do repositorio principal (${root}). ` +
        'O agente nunca pode escrever no working directory do usuario.',
    );
  }
}

export async function createWorktree(issueNumber: number): Promise<Worktree> {
  const dir = worktreeDir(issueNumber);
  const branch = branchName(issueNumber);

  assertOutsideProjectRoot(dir);

  await removeWorktree(dir);
  fs.mkdirSync(config.worktree.root, { recursive: true });

  await runOrThrow('git', ['fetch', 'origin', config.github.baseBranch], { cwd: PROJECT_ROOT });

  // Branch pode ter sobrado de uma tentativa anterior; -B recria a partir do main atual.
  await runOrThrow(
    'git',
    ['worktree', 'add', '-B', branch, dir, `origin/${config.github.baseBranch}`],
    { cwd: PROJECT_ROOT },
  );

  const sha = await runOrThrow('git', ['rev-parse', 'HEAD'], { cwd: dir });

  return { dir, branch, issueNumber, baseSha: sha.stdout.trim() };
}

/** Remove o worktree (e o diretorio orfao, se o git nao souber dele). */
export async function removeWorktree(dir: string): Promise<void> {
  assertOutsideProjectRoot(dir);
  await run('git', ['worktree', 'remove', '--force', dir], { cwd: PROJECT_ROOT });
  await run('git', ['worktree', 'prune'], { cwd: PROJECT_ROOT });
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Arquivos alterados no worktree, em caminhos relativos com `/`, incluindo untracked. */
export async function changedPaths(dir: string): Promise<string[]> {
  const result = await runOrThrow('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: dir,
  });
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const rest = line.slice(line.indexOf(' ') + 1).trim();
      // renomeacao vem como "antigo -> novo"; o que importa e o destino
      const arrow = rest.lastIndexOf(' -> ');
      const target = arrow >= 0 ? rest.slice(arrow + 4) : rest;
      return target.replace(/^"|"$/g, '').replace(/\\/g, '/');
    });
}

export async function diffSummary(dir: string): Promise<string> {
  const result = await run('git', ['diff', '--stat', 'HEAD'], { cwd: dir });
  return result.stdout.trim();
}

export async function commitAll(dir: string, message: string): Promise<string> {
  await runOrThrow('git', ['add', '--all'], { cwd: dir });
  await runOrThrow('git', ['commit', '--message', message], { cwd: dir });
  const sha = await runOrThrow('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return sha.stdout.trim();
}

export async function pushBranch(dir: string, branch: string): Promise<void> {
  await runOrThrow('git', ['push', '--force-with-lease', '--set-upstream', 'origin', branch], {
    cwd: dir,
    timeoutMs: 3 * 60_000,
  });
}

/** Instala dependencias no worktree novo, necessario para rodar os testes. */
export async function installDependencies(dir: string): Promise<void> {
  await runOrThrow('npm', ['ci'], {
    cwd: path.join(dir, 'backend'),
    timeoutMs: 10 * 60_000,
  });
  await runOrThrow('npx', ['prisma', 'generate'], {
    cwd: path.join(dir, 'backend'),
    timeoutMs: 5 * 60_000,
  });
}
