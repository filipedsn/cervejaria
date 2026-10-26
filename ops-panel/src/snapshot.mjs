import { collectDev } from './collectors/dev.mjs';
import { collectGit } from './collectors/git.mjs';
import { collectGithub } from './collectors/github.mjs';
import { collectPrd } from './collectors/prd.mjs';
import { cached, collect } from './exec.mjs';

const JUST_MERGED_MS = 5 * 60_000;

/**
 * Algo está andando sozinho (testes de PR, esteira rodando, merge recente sem run)?
 * Esperando autorização não conta: aí quem anda é o usuário.
 */
export function isMoving({ git, github, prd }, now = Date.now()) {
  const gh = github?.ok ? github.data : null;
  if (gh?.runs.some((r) => r.status !== 'completed' && r.status !== 'waiting')) return true;
  if (gh?.prs.some((p) => p.ci === 'pending')) return true;
  const g = git?.ok ? git.data : null;
  const prdSha = prd?.ok ? prd.data.releaseSha : null;
  return Boolean(g?.mainSha && prdSha && g.mainSha !== prdSha && g.mainDate && now - Date.parse(g.mainDate) < JUST_MERGED_MS);
}

let moving = false;

export async function collectSnapshot({ force = false } = {}) {
  const [git, github, dev, prd] = await Promise.all([
    collect(() => collectGit({ force, maxAgeMs: moving ? 10_000 : 30_000 })),
    cached('github', moving ? 5_000 : 20_000, () => collect(collectGithub), force),
    collect(collectDev),
    collect(() => collectPrd({ force, vpsMaxAgeMs: moving ? 15_000 : 60_000 })),
  ]);

  // O GitHub já viu uma main nova (push recente) que o clone local ainda não buscou.
  let gitNow = git;
  const newest = github.ok ? github.data.runs.find((r) => r.event === 'push') : null;
  if (git.ok && newest && newest.sha !== git.data.mainSha) {
    gitNow = await collect(() => collectGit({ maxAgeMs: 5_000 }));
  }

  const snapshot = { at: new Date().toISOString(), git: gitNow, github, dev, prd };
  moving = isMoving(snapshot);
  return { ...snapshot, moving };
}
