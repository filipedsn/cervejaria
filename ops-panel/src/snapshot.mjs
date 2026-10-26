import { collectDev } from './collectors/dev.mjs';
import { collectGit } from './collectors/git.mjs';
import { collectGithub } from './collectors/github.mjs';
import { collectPrd } from './collectors/prd.mjs';
import { cached, collect } from './exec.mjs';

export async function collectSnapshot({ force = false } = {}) {
  const [git, github, dev, prd] = await Promise.all([
    collect(() => collectGit({ force })),
    cached('github', 30_000, () => collect(collectGithub), force),
    collect(collectDev),
    collect(() => collectPrd({ force })),
  ]);
  return { at: new Date().toISOString(), git, github, dev, prd };
}
