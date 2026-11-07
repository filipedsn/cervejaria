import type { ReleaseInfoConfig } from '../config.js';
import type { FetchLike } from './probes.js';

export type ReleaseWorkItem = { identifier: string; name?: string; state?: string; summary?: string };
export type ReleasePull = { number: number; title: string; url: string; summary?: string; workItems: string[] };
export type ReleaseDetails = {
  sha: string;
  previousSha?: string;
  pulls: ReleasePull[];
  /** Commits that did not come from a PR (subject line only). */
  directCommits: string[];
  workItems: Record<string, ReleaseWorkItem>;
  omittedPulls: number;
};

const GITHUB_API = 'https://api.github.com';
const MAX_PULLS = 5;
const MAX_WORK_ITEMS = 8;
const SUMMARY_MAX = 300;
const MESSAGE_MAX = 3500;
const WORK_ITEM_REF = /\bTAP-(\d{1,6})\b/g;

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown> {
  try {
    const response = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    return await response.json();
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clip(value: string, max = SUMMARY_MAX): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function workItemRefs(...sources: Array<string | undefined>): string[] {
  const refs = new Set<string>();
  for (const source of sources) {
    for (const match of source?.matchAll(WORK_ITEM_REF) ?? []) refs.add(`TAP-${match[1]}`);
  }
  return [...refs];
}

/** First meaningful lines of a PR body: no headings, checklists, Refs or tool footers. */
export function summarizePullBody(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const lines = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^[-*]\s*\[[ xX]\]/.test(line))
    .filter((line) => !/^(refs|closes|fixes):/i.test(line) && !/made with \[?cursor/i.test(line) && !/^co-authored-by:/i.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/`/g, '').replace(/\*\*/g, ''));
  const joined = lines.reduce((acc, line) => (acc ? `${acc}${/[.!?;:]$/.test(acc) ? ' ' : '; '}${line}` : line), '');
  return joined ? clip(joined) : undefined;
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function summarizeWorkItemHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const plain = html
    .replace(/<\/(p|li|div|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
  return plain ? clip(plain) : undefined;
}

function githubHeaders(): Record<string, string> {
  return { Accept: 'application/vnd.github+json', 'User-Agent': 'quiver-tap-support-analyst' };
}

async function releaseCommitMessages(fetchImpl: FetchLike, repo: string, sha: string, previousSha?: string): Promise<string[]> {
  if (previousSha) {
    const compare = record(await getJson(fetchImpl, `${GITHUB_API}/repos/${repo}/compare/${previousSha}...${sha}`, githubHeaders()));
    const commits = Array.isArray(compare?.commits) ? compare.commits : undefined;
    if (commits && commits.length > 0) {
      return commits
        .map((commit) => text(record(record(commit)?.commit)?.message))
        .filter((message): message is string => Boolean(message))
        .reverse();
    }
  }
  const single = record(await getJson(fetchImpl, `${GITHUB_API}/repos/${repo}/commits/${sha}`, githubHeaders()));
  const message = text(record(single?.commit)?.message);
  return message ? [message] : [];
}

async function fetchPull(fetchImpl: FetchLike, repo: string, number: number, commitMessage: string): Promise<ReleasePull> {
  const pull = record(await getJson(fetchImpl, `${GITHUB_API}/repos/${repo}/pulls/${number}`, githubHeaders()));
  const subject = commitMessage.split(/\r?\n/, 1)[0]!.replace(/\s*\(#\d+\)\s*$/, '');
  const title = text(pull?.title) ?? subject;
  const body = text(pull?.body);
  return {
    number,
    title,
    url: text(pull?.html_url) ?? `https://github.com/${repo}/pull/${number}`,
    summary: summarizePullBody(body) ?? summarizePullBody(commitMessage.split(/\r?\n/).slice(1).join('\n')),
    workItems: workItemRefs(title, body, commitMessage),
  };
}

async function fetchWorkItem(fetchImpl: FetchLike, config: ReleaseInfoConfig, identifier: string): Promise<ReleaseWorkItem> {
  if (!config.planeApiKey) return { identifier };
  const url = `${config.planeUrl}/api/v1/workspaces/${config.planeWorkspace}/work-items/${identifier}/?expand=state`;
  const item = record(await getJson(fetchImpl, url, { 'X-API-Key': config.planeApiKey, Accept: 'application/json' }));
  if (!item) return { identifier };
  return {
    identifier,
    name: text(item.name),
    state: text(record(item.state)?.name),
    summary: summarizeWorkItemHtml(text(item.description_html)) ?? (text(item.description_stripped) ? clip(text(item.description_stripped)!) : undefined),
  };
}

/** SHA → commits since the previous release → PRs (title, link, summary) → TAP work items. */
export async function describeRelease(fetchImpl: FetchLike, config: ReleaseInfoConfig, sha: string, previousSha?: string): Promise<ReleaseDetails> {
  const messages = await releaseCommitMessages(fetchImpl, config.githubRepo, sha, previousSha);
  const pulls: ReleasePull[] = [];
  const directCommits: string[] = [];
  const seen = new Set<number>();
  let omittedPulls = 0;
  for (const message of messages) {
    const subject = message.split(/\r?\n/, 1)[0]!;
    const number = Number(subject.match(/\(#(\d+)\)\s*$/)?.[1]);
    if (!Number.isSafeInteger(number) || number <= 0) {
      directCommits.push(subject);
      continue;
    }
    if (seen.has(number)) continue;
    seen.add(number);
    if (pulls.length >= MAX_PULLS) { omittedPulls += 1; continue; }
    pulls.push(await fetchPull(fetchImpl, config.githubRepo, number, message));
  }
  const refs = [...new Set([...pulls.flatMap((pull) => pull.workItems), ...workItemRefs(...directCommits)])].slice(0, MAX_WORK_ITEMS);
  const workItems: Record<string, ReleaseWorkItem> = {};
  for (const identifier of refs) workItems[identifier] = await fetchWorkItem(fetchImpl, config, identifier);
  return { sha, previousSha, pulls, directCommits, workItems, omittedPulls };
}

function workItemLines(item: ReleaseWorkItem): string[] {
  const head = `WI ${item.identifier}${item.name ? ` — ${item.name}` : ''}${item.state ? ` (${item.state})` : ''}`;
  return item.summary ? [head, `Sobre o WI: ${item.summary}`] : [head];
}

/** Plain-text body for formatInfo (Telegram without parse_mode). */
export function formatReleaseNotice(details: ReleaseDetails): string {
  const lines = [`Nova versão no ar: ${details.sha.slice(0, 7)}${details.previousSha ? ` (anterior: ${details.previousSha.slice(0, 7)})` : ''}`];
  const shown = new Set<string>();
  for (const pull of details.pulls) {
    lines.push('', `PR #${pull.number} — ${pull.title}`, pull.url);
    if (pull.summary) lines.push(`O que muda: ${pull.summary}`);
    for (const ref of pull.workItems) {
      const item = details.workItems[ref];
      if (!item || shown.has(ref)) continue;
      shown.add(ref);
      lines.push(...workItemLines(item));
    }
  }
  if (details.omittedPulls > 0) lines.push('', `+${details.omittedPulls} PR(s) não listados`);
  if (details.directCommits.length > 0) {
    lines.push('', `Commits sem PR: ${details.directCommits.slice(0, 3).join('; ')}${details.directCommits.length > 3 ? '…' : ''}`);
  }
  for (const item of Object.values(details.workItems)) {
    if (!shown.has(item.identifier)) lines.push(...workItemLines(item));
  }
  if (details.pulls.length === 0 && details.directCommits.length === 0) lines.push('PR e WI não identificados (GitHub indisponível).');
  return clip(lines.join('\n'), MESSAGE_MAX);
}
