import { ROOT } from '../config.mjs';
import { firstLine, run } from '../exec.mjs';

const git = (...args) => run('git', args, { cwd: ROOT, timeoutMs: 10_000 });
let lastFetchAt = 0;

export async function collectGit({ force = false } = {}) {
  if (force || Date.now() - lastFetchAt > 60_000) {
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

  return {
    branch: branch.stdout.trim(),
    headSha: head.stdout.trim(),
    dirtyCount: status.stdout.split(/\r?\n/).filter(Boolean).length,
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
