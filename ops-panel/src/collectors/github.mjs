import { config } from '../config.mjs';
import { runJson } from '../exec.mjs';

const R = config.repo;
const gh = (args, options) => runJson('gh', args, { timeoutMs: 20_000, ...options });

const FAILED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

/** Estado do check obrigatório num statusCheckRollup do gh: none | pending | success | failure. */
export function ciState(rollup, checkName = config.ciCheckName) {
  const check = (rollup ?? []).filter((c) => (c.name ?? c.context) === checkName).at(-1);
  if (!check) return 'none';
  if (check.status && check.status !== 'COMPLETED') return 'pending';
  const conclusion = check.conclusion ?? check.state;
  if (conclusion === 'SUCCESS') return 'success';
  if (FAILED.has(conclusion)) return 'failure';
  return 'pending';
}

function normalizePr(pr) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    branch: pr.headRefName,
    headSha: pr.headRefOid,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    mergeState: pr.mergeStateStatus,
    baseBranch: pr.baseRefName,
    ci: ciState(pr.statusCheckRollup),
  };
}

const PR_FIELDS = 'number,title,url,headRefName,headRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,statusCheckRollup';

export async function collectGithub() {
  const [prs, runs] = await Promise.all([
    gh(['pr', 'list', '--repo', R, '--state', 'open', '--limit', '20', '--json', PR_FIELDS]),
    gh([
      'run', 'list', '--repo', R, '--workflow', config.deployWorkflow, '--limit', '8',
      '--json', 'databaseId,headSha,status,conclusion,createdAt,updatedAt,url,event,displayTitle',
    ]),
  ]);

  const normalizedRuns = runs.map((r) => ({
    id: r.databaseId,
    sha: r.headSha,
    status: r.status,
    conclusion: r.conclusion || null,
    event: r.event,
    title: r.displayTitle,
    url: r.url,
    createdAt: r.createdAt,
  }));

  const active = normalizedRuns.find((r) => r.status !== 'completed');
  const waiting = normalizedRuns.find((r) => r.status === 'waiting');
  const [jobs, pending] = await Promise.all([
    active ? gh(['run', 'view', String(active.id), '--repo', R, '--json', 'jobs']).then((v) => v.jobs) : null,
    waiting ? gh(['api', `repos/${R}/actions/runs/${waiting.id}/pending_deployments`]) : null,
  ]);
  if (active && jobs) active.jobs = jobs.map((j) => ({ name: j.name, status: j.status, conclusion: j.conclusion || null }));
  if (waiting && pending) {
    waiting.pending = pending.map((p) => ({
      environmentId: p.environment.id,
      environment: p.environment.name,
      canApprove: p.current_user_can_approve,
    }));
  }

  return { prs: prs.map(normalizePr), runs: normalizedRuns };
}

export async function fetchPr(number) {
  const pr = await gh(['pr', 'view', String(number), '--repo', R, '--json', `${PR_FIELDS},state,commits,files`]);
  return {
    ...normalizePr(pr),
    state: pr.state,
    commits: (pr.commits ?? []).map((c) => ({ sha: c.oid.slice(0, 7), subject: c.messageHeadline })),
    migrations: [
      ...new Set(
        (pr.files ?? [])
          .map((f) => f.path.match(/^backend\/prisma\/migrations\/([^/]+)\//)?.[1])
          .filter(Boolean),
      ),
    ],
  };
}

export async function fetchPendingDeployments(runId) {
  return gh(['api', `repos/${R}/actions/runs/${runId}/pending_deployments`]);
}

export async function reviewDeployment(runId, environmentIds, state, comment) {
  const body = JSON.stringify({ environment_ids: environmentIds, state, comment });
  return gh(['api', '-X', 'POST', `repos/${R}/actions/runs/${runId}/pending_deployments`, '--input', '-'], { input: body });
}
