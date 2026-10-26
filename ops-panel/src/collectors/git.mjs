import { ROOT } from '../config.mjs';
import { firstLine, run } from '../exec.mjs';

const git = (...args) => run('git', args, { cwd: ROOT, timeoutMs: 10_000 });
let lastFetchAt = 0;

export async function collectGit({ force = false, maxAgeMs = 30_000 } = {}) {
  if (force || Date.now() - lastFetchAt > maxAgeMs) {
    const fetched = await run('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: ROOT, timeoutMs: 20_000 });
    if (fetched.code === 0) lastFetchAt = Date.now();
  }

  const [branch, head, status, counts, recent] = await Promise.all([
    git('rev-parse', '--abbrev-ref', 'HEAD'),
    git('rev-parse', 'HEAD'),
    git('status', '--porcelain'),
    git('rev-list', '--left-right', '--count', 'HEAD...origin/main'),
    git('log', '-n', '10', '--format=%H%x09%cI%x09%s', 'origin/main'),
  ]);
  if (head.code !== 0) throw new Error(firstLine(head.stderr) || 'git indisponível');

  const [ahead = 0, behind = 0] = counts.stdout.trim().split(/\s+/).map(Number);
  const recentMain = recent.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, date, ...subject] = line.split('\t');
      return { sha, date, subject: subject.join('\t') };
    });

  const statusLines = status.stdout.split(/\r?\n/).filter(Boolean);
  return {
    branch: branch.stdout.trim(),
    headSha: head.stdout.trim(),
    dirtyCount: statusLines.length,
    trackedDirty: statusLines.filter((line) => !line.startsWith('??')).length,
    ahead,
    behind,
    mainSha: recentMain[0]?.sha ?? null,
    mainSubject: recentMain[0]?.subject ?? '',
    mainDate: recentMain[0]?.date ?? null,
    recentMain,
    fetchedAt: lastFetchAt ? new Date(lastFetchAt).toISOString() : null,
  };
}

export async function isOnMain(sha) {
  return (await git('merge-base', '--is-ancestor', sha, 'origin/main')).code === 0;
}

const SHA_LIKE = /^[0-9a-f]{7,40}$/;
// Número de versão = commits alcançáveis (squash na main: +1 por PR). Commit da main não muda de número.
const versionCache = new Map();

/** { sha: 855 | null } — null quando o commit não faz parte da main (ou não existe no clone). */
export async function versionsFor(shas) {
  const unique = [...new Set(shas.filter((s) => SHA_LIKE.test(s ?? '')))];
  const out = {};
  for (const sha of unique) {
    if (!versionCache.has(sha) && (await isOnMain(sha))) {
      const count = Number((await git('rev-list', '--count', sha)).stdout.trim());
      if (count > 0) versionCache.set(sha, count);
    }
    out[sha] = versionCache.get(sha) ?? null;
  }
  return out;
}

/**
 * { sha: { base: 865, ahead: 1 } } para commits fora da main (PR, pasta de trabalho):
 * a versão da main de onde saíram e quantas mudanças têm a mais. Commit da main fica de fora.
 */
export async function baseVersionsFor(shas) {
  const unique = [...new Set(shas.filter((s) => SHA_LIKE.test(s ?? '')))];
  const out = {};
  for (const sha of unique) {
    if (versionCache.has(sha) || (await isOnMain(sha))) continue;
    const base = (await git('merge-base', sha, 'origin/main')).stdout.trim();
    if (!SHA_LIKE.test(base)) continue;
    const [count, ahead] = await Promise.all([git('rev-list', '--count', base), git('rev-list', '--count', `${base}..${sha}`)]);
    const n = Number(count.stdout.trim());
    const a = Number(ahead.stdout.trim());
    if (n > 0 && a > 0) out[sha] = { base: n, ahead: a };
  }
  return out;
}

/** Commits que existem em `to` e não em `from` (mais novos primeiro). */
export async function commitsBetween(from, to, limit = 15) {
  if (!SHA_LIKE.test(from ?? '') || !SHA_LIKE.test(to ?? '') || from === to) return [];
  const log = await git('log', '-n', String(limit), '--format=%H%x09%s', `${from}..${to}`);
  if (log.code !== 0) return [];
  return log.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, ...subject] = line.split('\t');
      return { sha, subject: subject.join('\t') };
    });
}

/** O que muda em PRD indo de `from` para `to` (commits e pastas de migration). */
export async function previewRange(from, to) {
  const forward = (await git('merge-base', '--is-ancestor', from, to)).code === 0;
  const [base, tip] = forward ? [from, to] : [to, from];
  const [log, files] = await Promise.all([
    git('log', '--format=%h%x09%s', `${base}..${tip}`),
    git('diff', '--name-only', base, tip, '--', 'backend/prisma/migrations'),
  ]);
  if (log.code !== 0) throw new Error(firstLine(log.stderr) || 'commit não encontrado no clone local');
  const commits = log.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, ...subject] = line.split('\t');
      return { sha, subject: subject.join('\t') };
    });
  const migrations = [
    ...new Set(
      files.stdout
        .split(/\r?\n/)
        .map((file) => file.match(/^backend\/prisma\/migrations\/([^/]+)\//)?.[1])
        .filter(Boolean),
    ),
  ];
  return { from, to, direction: forward ? 'forward' : 'rollback', commits, migrations };
}
