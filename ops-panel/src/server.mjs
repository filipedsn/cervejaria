import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import {
  DEFAULT_REQUIRED_CHECKS,
  OVERRIDE_CONFIRM,
  collectGitStateWithAutoSync,
  evaluateReleaseGate,
  readDeployRecovery,
  readLocalCiAttestation,
  readManifest,
  readReleaseHistory,
  readRollbackPoint,
  runGit,
} from './release.mjs';
import { isTrustedLocalOperator } from './local-auth.mjs';
import { safeJourneyPayload } from './journey-evidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPS_PANEL_DIR = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(OPS_PANEL_DIR, '..');

loadEnvFile(path.join(OPS_PANEL_DIR, '.env'));

const HOST = process.env.OPS_PANEL_HOST || '127.0.0.1';
const PORT = Number(process.env.OPS_PANEL_PORT || 3099);
const OPS_TOKEN = process.env.OPS_PANEL_TOKEN || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'filipedsn/cervejaria';

const RUNTIME_DIR = path.join(PROJECT_ROOT, 'deploy', 'runtime');
const LOG_DIR = path.join(PROJECT_ROOT, 'deploy', 'logs');
const BACKUP_DIR = path.join(PROJECT_ROOT, 'deploy', 'backups');
const AUDIT_LOG = path.join(LOG_DIR, 'ops-panel.log');
const OPS_PANEL_META = path.join(RUNTIME_DIR, 'ops-panel.meta.json');
const OPS_PANEL_VERSION = 2;
const STARTED_AT = new Date().toISOString();
const PROD_ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'deploy', 'prod-artifacts');
const PROD_MANIFEST = path.join(PROD_ARTIFACTS_DIR, 'manifest.json');
const PROD_ARTIFACTS_PREVIOUS = path.join(PROJECT_ROOT, 'deploy', 'prod-artifacts.previous');
const DEPLOY_RECOVERY = path.join(RUNTIME_DIR, 'deploy-recovery.json');
const RELEASE_HISTORY = path.join(RUNTIME_DIR, 'release-history.json');
const OBS_ENV_FILE = path.join(PROJECT_ROOT, 'deploy', 'observability', '.env.observability');

const REQUIRED_CHECKS = (process.env.OPS_PANEL_REQUIRED_CHECKS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const PORTS = {
  prodApi: 3001,
  devApi: 3002,
  devFrontend: 5202,
};

const actionCooldownMs = 10_000;
const lastActionAt = new Map();

const LOG_FILES = {
  'api-error.log': { label: 'API prod · erros', description: 'Erros stderr da API de producao (:3001)' },
  'api.log': { label: 'API prod · saida', description: 'Stdout da API de producao' },
  'watchdog.log': { label: 'Watchdog', description: 'Monitor daemon (prod)' },
  'ops-panel.log': { label: 'Ops panel', description: 'Auditoria de acoes do painel' },
  'dev-api-error.log': { label: 'API dev · erros', description: 'Erros stderr da API dev (:3002)' },
  'dev-frontend-error.log': { label: 'Vite · erros', description: 'Erros stderr do Vite dev (:5202)' },
  'dev-supervisor.log': { label: 'Supervisor', description: 'Supervisor de desenvolvimento' },
};

function logMeta(name) {
  const entry = LOG_FILES[name];
  if (!entry) return { label: name, description: name };
  if (typeof entry === 'string') return { label: name.replace('.log', ''), description: entry };
  return entry;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  // O BOM que o PowerShell 5.1 escreve gruda na primeira chave (\uFEFFGITHUB_TOKEN),
  // e a variavel some sem nenhum erro visivel.
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // O arquivo local ganha, exceto porta: permite fallback quando :3099 esta presa.
    if (key === 'OPS_PANEL_PORT' && process.env.OPS_PANEL_PORT) continue;
    process.env[key] = value;
  }
}

function readObservabilityConfig() {
  if (!fs.existsSync(OBS_ENV_FILE)) return null;
  const values = {};
  for (const line of fs.readFileSync(OBS_ENV_FILE, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf('=');
    if (!trimmed || trimmed.startsWith('#') || eq < 1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  const baseUrl = (values.ELASTICSEARCH_URL || '').replace(/\/$/, '');
  if (!baseUrl) return null;
  const authorization = values.ELASTIC_API_KEY
    ? `ApiKey ${values.ELASTIC_API_KEY}`
    : values.ELASTIC_PASSWORD
      ? `Basic ${Buffer.from(`${values.ELASTIC_USER || 'elastic'}:${values.ELASTIC_PASSWORD}`).toString('base64')}`
      : null;
  return { baseUrl, authorization };
}

function alertSeverity(ruleName = '') {
  if (/api-ready|public-ready|postgres|5xx|transacao-failure/.test(ruleName)) return 'critical';
  if (/eventloop|ui-error|es-cluster|slo-availability/.test(ruleName)) return 'high';
  return 'medium';
}

async function readAlertsFromElastic() {
  const config = readObservabilityConfig();
  if (!config) return { source: 'unavailable', reason: 'Configuracao Elastic ausente', alerts: [] };
  const response = await fetch(`${config.baseUrl}/quiver-tap-alert-events/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.authorization ? { Authorization: config.authorization } : {}) },
    body: JSON.stringify({ size: 30, sort: [{ '@timestamp': 'desc' }], _source: ['@timestamp', 'ruleId', 'ruleName', 'environment', 'alertState', 'severity', 'reason', 'viewInAppUrl'] }),
  });
  if (!response.ok) return { source: 'unavailable', reason: `Elastic HTTP ${response.status}`, alerts: [] };
  const data = await response.json();
  const alerts = (data.hits?.hits ?? []).map((hit) => {
    const source = hit._source ?? {};
    const ruleName = typeof source.ruleName === 'string' ? source.ruleName : 'Regra desconhecida';
    const rawState = typeof source.alertState === 'string' ? source.alertState.trim() : '';
    return {
      id: typeof hit._id === 'string' ? hit._id : undefined,
      ruleId: typeof source.ruleId === 'string' ? source.ruleId : undefined,
      ruleName,
      environment: typeof source.environment === 'string' ? source.environment : (ruleName.includes('-prd') ? 'prd' : ruleName.includes('-dev') ? 'dev' : 'unknown'),
      state: rawState || 'UNKNOWN',
      severity: typeof source.severity === 'string' ? source.severity : alertSeverity(ruleName),
      timestamp: typeof source['@timestamp'] === 'string' ? source['@timestamp'] : undefined,
      kibanaUrl: typeof source.viewInAppUrl === 'string' ? source.viewInAppUrl : undefined,
      message: typeof source.reason === 'string' ? source.reason.slice(0, 300) : undefined,
    };
  });
  return { source: 'elastic', alerts };
}

const JOURNEY_SOURCE_FIELDS = [
  // Raw messages are deliberately not queried: an operational timeline never needs
  // arbitrary log text, which could reintroduce user-entered content or PII.
  '@timestamp', 'trace_id', 'span_id',
  'attributes.event.action', 'attributes.event.outcome',
  'attributes.cervejaria.id', 'attributes.actor.id', 'attributes.actor.role',
  'attributes.ui.page', 'attributes.http.route', 'attributes.http.request.method',
  'attributes.http.response.status_code', 'attributes.durationMs',
  'attributes.entity.type', 'attributes.entity.id',
  'attributes.correlationId', 'attributes.requestId', 'attributes.event',
  'attributes.event.id', 'attributes.interactionId', 'attributes.db.transaction.id',
  'attributes.db.transaction.state', 'attributes.db.duration_ms', 'attributes.http.response.duration_ms',
  'attributes.metadata',
  'attributes.target.cervejaria.id',
  'attributes.cervejariaId', 'attributes.actorId', 'attributes.userId', 'attributes.role',
].join(',');

function journeyValue(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,200}$/.test(value) ? value : undefined;
}

function journeyRange(value, fallback) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function readJourneyFilters(query = {}) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const environment = query.environment === 'prd' ? 'prd' : 'dev';
  return {
    environment,
    from: journeyRange(query.from, defaultFrom),
    to: journeyRange(query.to, now.toISOString()),
    tenantId: journeyValue(query.tenantId),
    actorId: journeyValue(query.actorId),
    action: journeyValue(query.action),
    where: journeyValue(query.where),
    outcome: query.outcome === 'success' || query.outcome === 'failure' ? query.outcome : undefined,
    correlationId: journeyValue(query.correlationId),
    interactionId: journeyValue(query.interactionId),
  };
}

function journeyTimestamp(value) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  const epoch = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : undefined;
}

function journeyEvent(hit) {
  const attributes = hit?._source?.attributes ?? {};
  const text = (value) => typeof value === 'string' ? value : undefined;
  const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    id: typeof hit?._id === 'string' ? hit._id : undefined,
    eventId: text(attributes['event.id']),
    interactionId: text(attributes.interactionId),
    transactionId: text(attributes['db.transaction.id']),
    transactionState: text(attributes['db.transaction.state']),
    payload: safeJourneyPayload(attributes.metadata),
    timestamp: journeyTimestamp(hit?._source?.['@timestamp']),
    source: String(hit?._index || '').includes('logs-technical') ? 'technical' : 'audit',
    action: text(attributes['event.action']) || text(attributes.event),
    outcome: text(attributes['event.outcome']),
    tenantId: text(attributes['cervejaria.id']) || text(attributes.cervejariaId),
    targetTenantId: text(attributes['target.cervejaria.id']),
    actorId: text(attributes['actor.id']) || text(attributes.actorId) || text(attributes.userId),
    actorRole: text(attributes['actor.role']) || text(attributes.role),
    page: text(attributes['ui.page']),
    route: text(attributes['http.route']),
    method: text(attributes['http.request.method']),
    statusCode: number(attributes['http.response.status_code']),
    durationMs: number(attributes.durationMs) ?? number(attributes['http.response.duration_ms']) ?? number(attributes['db.duration_ms']),
    entityType: text(attributes['entity.type']),
    entityId: text(attributes['entity.id']),
    correlationId: text(attributes.correlationId),
    requestId: text(attributes.requestId),
    traceId: text(hit?._source?.trace_id),
    spanId: text(hit?._source?.span_id),
  };
}

async function readOperationJourney(query) {
  const config = readObservabilityConfig();
  if (!config) return { source: 'unavailable', reason: 'Configuracao Elastic ausente', events: [] };
  const filters = readJourneyFilters(query);
  const clauses = [{ range: { '@timestamp': { gte: filters.from, lte: filters.to } } }];
  const fields = {
    // These custom OTel attributes are mapped as exact fields by the existing
    // data streams; adding a `.keyword` suffix would make valid audit events
    // disappear on clusters that use flattened attributes.
    where: 'attributes.http.route',
    outcome: 'attributes.event.outcome', correlationId: 'attributes.correlationId',
    interactionId: 'attributes.interactionId',
  };
  for (const [key, field] of Object.entries(fields)) {
    if (filters[key]) clauses.push({ term: { [field]: filters[key] } });
  }
  for (const [key, alternatives] of Object.entries({
    tenantId: ['attributes.cervejaria.id', 'attributes.cervejariaId', 'attributes.target.cervejaria.id'],
    actorId: ['attributes.actor.id', 'attributes.actorId', 'attributes.userId'],
  })) {
    if (filters[key]) clauses.push({ bool: { should: alternatives.map(field => ({ term: { [field]: filters[key] } })), minimum_should_match: 1 } });
  }
  if (filters.action) {
    // Audit uses event.action while a few inherited technical signals use the
    // older attributes.event field. Both are existing schemas, not a fallback
    // pipeline, so the visible action filter covers the whole journey.
    clauses.push({ bool: { should: [
      { term: { 'attributes.event.action': filters.action } },
      { term: { 'attributes.event': filters.action } },
    ], minimum_should_match: 1 } });
  }
  const body = JSON.stringify({ size: 200, sort: [{ '@timestamp': 'asc' }], _source: JOURNEY_SOURCE_FIELDS.split(','), query: { bool: { filter: clauses } } });
  const headers = { 'Content-Type': 'application/json', ...(config.authorization ? { Authorization: config.authorization } : {}) };
  const [audit, technical] = await Promise.all(['audit', 'technical'].map((kind) =>
    fetch(`${config.baseUrl}/logs-${kind}*.otel-${filters.environment}*/_search`, { method: 'POST', headers, body }),
  ));
  if (!audit.ok || !technical.ok) return { source: 'unavailable', reason: `Elastic HTTP ${!audit.ok ? audit.status : technical.status}`, events: [] };
  const [auditData, technicalData] = await Promise.all([audit.json(), technical.json()]);
  const auditEvents = (auditData.hits?.hits ?? []).map(journeyEvent).filter((event) => event.timestamp && event.action);
  const technicalEvents = (technicalData.hits?.hits ?? []).map(journeyEvent)
    .filter((event) => event.timestamp && (event.action || (event.statusCode ?? 0) >= 400));
  return { source: 'elastic', filters, events: [...auditEvents, ...technicalEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(0, 200) };
}

function audit(message) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(AUDIT_LOG, line, 'utf8');
}

function writeOpsPanelMeta() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const meta = {
    version: OPS_PANEL_VERSION,
    port: PORT,
    host: HOST,
    pid: process.pid,
    startedAt: STARTED_AT,
    url: `http://${HOST}:${PORT}`,
  };
  fs.writeFileSync(OPS_PANEL_META, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

function removeOpsPanelMeta() {
  try {
    if (fs.existsSync(OPS_PANEL_META)) fs.rmSync(OPS_PANEL_META);
  } catch {
    // ignore
  }
}

function readPid(name) {
  const file = path.join(RUNTIME_DIR, name);
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, 'utf8').trim());
  return Number.isFinite(pid) ? pid : null;
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // Windows: kill(0) em processo de outro contexto retorna EPERM mesmo vivo.
    if (err && err.code === 'EPERM') return true;
    return false;
  }
}

async function checkHttp(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function latestBackup() {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('backup-prod-') && f.endsWith('.sql'))
    .map((f) => {
      const full = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(full);
      return { name: f, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
  return files[0] || null;
}

function tailLog(fileName, lines = 80) {
  const file = path.join(LOG_DIR, fileName);
  if (!fs.existsSync(file)) {
    const meta = logMeta(fileName);
    return { content: '', exists: false, description: meta.description };
  }
  const content = fs.readFileSync(file, 'utf8');
  const tail = content.split('\n').slice(-lines).join('\n');
  return {
    content: tail,
    exists: true,
    empty: !content.trim(),
    description: logMeta(fileName).description,
  };
}

function cooldownRemaining(action) {
  const last = lastActionAt.get(action) || 0;
  return Math.max(0, actionCooldownMs - (Date.now() - last));
}

function requireToken(request, reply) {
  if (isTrustedLocalOperator(request, { port: PORT })) return true;
  if (OPS_TOKEN && request.headers['x-ops-token'] === OPS_TOKEN) return true;
  reply.code(403).send({
    error: 'Ops panel so aceita o navegador local (http://127.0.0.1:3099).',
  });
  return false;
}

function checkCooldown(action, reply) {
  const remaining = cooldownRemaining(action);
  if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    reply.code(429).send({
      error: `Aguarde ${seconds}s antes de repetir esta acao (evita cliques duplos).`,
      retryAfterSeconds: seconds,
      action,
    });
    return false;
  }
  lastActionAt.set(action, Date.now());
  return true;
}

function validateBackupDestination(dir) {
  if (!dir || typeof dir !== 'string') return '';
  const trimmed = dir.trim();
  if (!trimmed) return '';
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) {
    throw new Error('Caminho de destino deve ser absoluto.');
  }
  return resolved;
}

function runPickBackupFolderScript() {
  const psPath = path.join(PROJECT_ROOT, 'scripts/prod/pick-backup-folder.ps1');
  const resultFile = path.join(
    os.tmpdir(),
    `quiver-ops-folder-${Date.now()}-${process.pid}.txt`,
  );

  try {
    if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
  } catch {
    // ignore
  }

  if (!fs.existsSync(psPath)) {
    throw new Error('Seletor de pasta nao encontrado (pick-backup-folder.ps1).');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-WindowStyle', 'Hidden',
        '-Sta',
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', psPath,
        '-ResultFile', resultFile,
      ],
      { cwd: PROJECT_ROOT, windowsHide: true },
    );

    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      try {
        if (fs.existsSync(resultFile)) {
          resolve(readPickedFolder(resultFile));
          return;
        }
        if (code === 2) {
          resolve(null);
          return;
        }
        reject(new Error(stderr.trim() || `Seletor de pasta falhou (exit ${code ?? 1}).`));
      } catch (err) {
        reject(err);
      }
    });

    child.on('error', reject);
  });
}

function readPickedFolder(resultFile) {
  if (!fs.existsSync(resultFile)) {
    return null;
  }
  const picked = fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, '').trim();
  try {
    fs.unlinkSync(resultFile);
  } catch {
    // ignore
  }
  if (!picked) {
    throw new Error('Nenhuma pasta selecionada.');
  }
  return picked;
}

async function githubFetch(apiPath) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}${apiPath}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}`);
  }
  return res.json();
}

async function githubCiStatus() {
  if (!GITHUB_TOKEN) {
    return { configured: false, message: 'GITHUB_TOKEN nao configurado' };
  }
  try {
    const data = await githubFetch('/actions/runs?per_page=1');
    const run = data.workflow_runs?.[0];
    if (!run) return { configured: true, status: 'none' };
    return {
      configured: true,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      branch: run.head_branch,
      updatedAt: run.updated_at,
    };
  } catch (err) {
    return { configured: true, error: String(err) };
  }
}

async function githubSummary() {
  const base = {
    repo: GITHUB_REPO,
    pulls: `https://github.com/${GITHUB_REPO}/pulls`,
    actions: `https://github.com/${GITHUB_REPO}/actions`,
    branchesUrl: `https://github.com/${GITHUB_REPO}/branches`,
    commitsUrl: `https://github.com/${GITHUB_REPO}/commits/main`,
  };

  if (!GITHUB_TOKEN) {
    return { ...base, configured: false, message: 'GITHUB_TOKEN nao configurado' };
  }

  try {
    const [ci, pulls, commits, branches, closedPulls] = await Promise.all([
      githubCiStatus(),
      githubFetch('/pulls?state=open&per_page=5').catch(() => []),
      githubFetch('/commits?per_page=1').catch(() => []),
      githubFetch('/branches?per_page=12').catch(() => []),
      githubFetch('/pulls?state=closed&sort=updated&direction=desc&per_page=15').catch(() => []),
    ]);

    const lastCommit = commits[0]
      ? {
          sha: commits[0].sha.slice(0, 7),
          message: commits[0].commit.message.split('\n')[0].slice(0, 72),
          date: commits[0].commit.author.date,
          url: commits[0].html_url,
          author: commits[0].commit.author.name,
        }
      : null;

    const openPulls = Array.isArray(pulls)
      ? pulls.map((p) => ({
          number: p.number,
          title: p.title,
          branch: p.head.ref,
          url: p.html_url,
        }))
      : [];

    const branchList = Array.isArray(branches)
      ? branches.map((b) => ({
          name: b.name,
          url: `https://github.com/${GITHUB_REPO}/tree/${encodeURIComponent(b.name)}`,
        }))
      : [];

    const merged = Array.isArray(closedPulls) ? closedPulls.find((p) => p.merged_at) : null;
    const lastMerge = merged
      ? {
          number: merged.number,
          title: merged.title,
          mergedAt: merged.merged_at,
          url: merged.html_url,
        }
      : null;

    return {
      ...base,
      configured: true,
      ci,
      openPulls,
      openPullCount: openPulls.length,
      lastCommit,
      branches: branchList,
      branchCount: branchList.length,
      lastMerge,
    };
  } catch (err) {
    return { ...base, configured: true, error: String(err.message || err) };
  }
}

const requiredChecks = REQUIRED_CHECKS.length ? REQUIRED_CHECKS : DEFAULT_REQUIRED_CHECKS;

/** Enriquece cada commit pendente com o PR de origem. */
async function annotatePendingCommits(commits) {
  if (!GITHUB_TOKEN || !commits.length) return commits;

  // Limite deliberado: a API do GitHub cobra uma chamada por commit e a lista costuma
  // ser curta. Acima disso o painel mostra o commit sem PR em vez de estourar o rate limit.
  const limited = commits.slice(0, 15);
  const annotated = await Promise.all(
    limited.map(async (commit) => {
      try {
        const pulls = await githubFetch(`/commits/${commit.sha}/pulls`);
        const pr = Array.isArray(pulls) ? pulls[0] : null;
        if (!pr) return { ...commit, pr: null };
        return {
          ...commit,
          pr: { number: pr.number, title: pr.title, url: pr.html_url, branch: pr.head?.ref || null },
        };
      } catch {
        return { ...commit, pr: null, prError: true };
      }
    }),
  );

  return [...annotated, ...commits.slice(limited.length).map((c) => ({ ...c, pr: null }))];
}

async function buildReleaseState() {
  const deployed = readManifest(PROD_MANIFEST);
  const recovery = readDeployRecovery(DEPLOY_RECOVERY);
  const history = readReleaseHistory(RELEASE_HISTORY);
  const { git, sync } = await collectGitStateWithAutoSync(PROJECT_ROOT, deployed?.gitSha || null);

  if (!git.gitAvailable) {
    const gate = evaluateReleaseGate({ gitAvailable: false, recovery }, { requiredChecks });
    return {
      deployed,
      recovery,
      history,
      rollback: readRollbackPoint(PROD_ARTIFACTS_PREVIOUS),
      sync,
      ...git,
      checks: [],
      localCi: null,
      gate,
      gateWithMigrationsAck: gate,
      overridable: false,
      requiredChecks,
    };
  }

  const pending = await annotatePendingCommits(git.pending);
  const localCi = readLocalCiAttestation(PROJECT_ROOT);
  // checks permanece vazio: GitHub Actions desligado (TAP-116); o gate usa localCi.
  const state = {
    ...git,
    deployed,
    recovery,
    history,
    pending,
    checks: [],
    checksConfigured: true,
    checksError: null,
    localCi,
  };
  const gate = evaluateReleaseGate(state, { requiredChecks });

  return {
    ...state,
    sync,
    // Os dois veredictos vao prontos para a tela decidir se habilita o botao sem
    // reimplementar a regra no navegador. O POST /api/prod/deploy reavalia de todo jeito:
    // a decisao final nunca depende do que o cliente mandou.
    gate,
    gateWithMigrationsAck: evaluateReleaseGate(state, { requiredChecks, acknowledgeMigrations: true }),
    overridable: gate.blockers.every((b) => b.overridable),
    rollback: readRollbackPoint(PROD_ARTIFACTS_PREVIOUS),
    requiredChecks,
  };
}

function releaseSummaryForAudit(state, gate, body) {
  return [
    `head=${state.head?.sha?.slice(0, 7) || '?'}`,
    `branch=${state.head?.branch || '?'}`,
    `publicado=${state.deployed?.gitSha || 'nenhum'}`,
    `pendentes=${state.pending?.length ?? 0}`,
    `migrations=${state.migrationsChanged?.length ?? 0}`,
    `localCi=${state.localCi?.ok ? `ok:${(state.localCi.sha || '').slice(0, 8)}` : 'ausente'}`,
    `override=${gate.overridden ? `SIM motivo="${(body.overrideReason || '').slice(0, 120)}"` : 'nao'}`,
    `impedimentos=${gate.blockers.map((b) => b.code).join('|') || 'nenhum'}`,
  ].join(' ');
}

function streamLine(reply, line) {
  reply.raw.write(`${line}\n`);
}

function streamPowerShell(reply, { action, label, scriptRelative, psArgs = [], extraLogs = [] }) {
  const scriptPath = path.join(PROJECT_ROOT, scriptRelative);
  streamLine(reply, `=== ${label} ===`);
  streamLine(reply, `Script: ${scriptRelative}`);
  streamLine(reply, `Inicio: ${new Date().toLocaleString('pt-BR')}`);
  streamLine(reply, '');

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...psArgs],
    { cwd: PROJECT_ROOT, windowsHide: true },
  );

  child.stdout?.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line) streamLine(reply, line);
    }
  });

  child.stderr?.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line) streamLine(reply, `[stderr] ${line}`);
    }
  });

  child.on('close', (code) => {
    const exitCode = code ?? 1;
    streamLine(reply, '');
    streamLine(reply, `--- Fim: ${exitCode === 0 ? 'SUCESSO' : 'FALHA'} (exit ${exitCode}) ---`);

    for (const logName of extraLogs) {
      const log = tailLog(logName, 40);
      streamLine(reply, '');
      streamLine(reply, `=== ${logName} (ultimas linhas) ===`);
      if (!log.exists) {
        streamLine(reply, '(arquivo ainda nao existe)');
      } else if (log.empty) {
        streamLine(reply, '(vazio — sem erros registrados)');
      } else {
        for (const line of log.content.split('\n')) {
          if (line) streamLine(reply, line);
        }
      }
    }

    streamLine(reply, '');
    reply.raw.end();
    audit(`acao=${action} exit=${exitCode}`);
  });
}

async function handleStreamAction(request, reply, options) {
  if (!requireToken(request, reply)) return;
  if (!checkCooldown(options.action, reply)) return;

  audit(`acao=${options.action} ip=${request.ip} stream=1`);

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  streamPowerShell(reply, options);
}

const app = Fastify({ logger: false });

await app.register(fastifyStatic, {
  root: path.join(OPS_PANEL_DIR, 'public'),
  prefix: '/',
});

app.get('/api/health', async () => ({ ok: true, service: 'ops-panel' }));

app.get('/api/meta', async () => ({
  version: OPS_PANEL_VERSION,
  port: PORT,
  host: HOST,
  pid: process.pid,
  startedAt: STARTED_AT,
  url: `http://${HOST}:${PORT}`,
}));

app.get('/api/session', async (request) => ({
  trusted: isTrustedLocalOperator(request, { port: PORT }),
}));

app.get('/api/alerts', async () => {
  try {
    return await readAlertsFromElastic();
  } catch {
    return { source: 'unavailable', reason: 'Falha ao consultar fonte de alertas', alerts: [] };
  }
});

app.get('/api/operation-journey', async (request, reply) => {
  if (!requireToken(request, reply)) return;
  try {
    return await readOperationJourney(request.query);
  } catch {
    return { source: 'unavailable', reason: 'Falha ao consultar a jornada', events: [] };
  }
});

app.get('/api/logs', async () => ({
  files: Object.keys(LOG_FILES).map((name) => {
    const meta = logMeta(name);
    return { name, label: meta.label, description: meta.description };
  }),
}));

app.get('/api/status', async () => {
  const [prodReady, prodHealth, prodFrontend, devApi, devFrontend, alertPoller] = await Promise.all([
    checkHttp(`http://127.0.0.1:${PORTS.prodApi}/api/ready`),
    checkHttp(`http://127.0.0.1:${PORTS.prodApi}/api/health`),
    checkHttp(`http://127.0.0.1:${PORTS.prodApi}/`),
    checkHttp(`http://127.0.0.1:${PORTS.devApi}/api/health`),
    checkHttp(`http://127.0.0.1:${PORTS.devFrontend}/`),
    fetch('http://127.0.0.1:3098/health').then(async (res) => ({ ok: res.ok, status: res.status, body: await res.json().catch(() => null) })).catch(() => ({ ok: false, status: 0, body: null })),
  ]);

  const apiPid = readPid('api.pid');
  const watchdogPid = readPid('watchdog.pid');
  const opsPid = readPid('ops-panel.pid');
  const devSupervisorPid = readPid('dev-supervisor.pid');
  const tunnelPid = readPid('tunnel.pid');

  const ci = await githubSummary();

  const recovery = readDeployRecovery(DEPLOY_RECOVERY);

  return {
    timestamp: new Date().toISOString(),
    prod: {
      apiPort: PORTS.prodApi,
      ready: prodReady.ok,
      health: prodHealth.ok,
      frontend: prodFrontend.ok,
      apiPid,
      apiAlive: isProcessAlive(apiPid),
      publicUrl: 'https://tap.quivercloud.com.br',
      recovery,
    },
    dev: {
      apiPort: PORTS.devApi,
      frontendPort: PORTS.devFrontend,
      api: devApi.ok,
      frontend: devFrontend.ok,
      supervisorPid: devSupervisorPid,
      supervisorAlive: isProcessAlive(devSupervisorPid),
    },
    infra: {
      watchdogPid,
      watchdogAlive: isProcessAlive(watchdogPid),
      opsPanelPid: opsPid,
      opsPanelAlive: isProcessAlive(opsPid),
      // /api/ready executa SELECT 1 no Prisma; se a API nao respondeu, nao
      // atribuímos a falha especificamente ao banco.
      postgres: { ok: prodReady.ok ? true : null, source: 'api-ready' },
      alertPoller: { ok: alertPoller.ok, port: 3098, source: 'health', semantic: alertPoller.body },
      cloudflare: { ok: tunnelPid ? isProcessAlive(tunnelPid) : null, pid: tunnelPid, source: 'runtime-pid' },
    },
    backup: latestBackup(),
    github: ci,
  };
});

app.get('/api/logs/:name', async (request, reply) => {
  const { name } = request.params;
  if (!LOG_FILES[name]) {
    return reply.code(400).send({ error: 'Log nao permitido' });
  }
  const log = tailLog(name);
  return {
    name,
    description: log.description,
    content: log.content,
    empty: log.empty ?? !log.content.trim(),
    exists: log.exists,
  };
});

app.post('/api/dev/start', async (request, reply) => {
  return handleStreamAction(request, reply, {
    action: 'dev-start',
    label: 'Iniciar ambiente dev',
    scriptRelative: 'scripts/dev/start-dev.ps1',
    extraLogs: ['dev-api-error.log', 'dev-frontend-error.log'],
  });
});

app.post('/api/dev/stop', async (request, reply) => {
  return handleStreamAction(request, reply, {
    action: 'dev-stop',
    label: 'Parar ambiente dev',
    scriptRelative: 'scripts/dev/stop-dev.ps1',
  });
});

app.post('/api/prod/restart', async (request, reply) => {
  const recovery = readDeployRecovery(DEPLOY_RECOVERY);
  if (recovery.active) {
    return reply.code(409).send({
      error: `INTERVENCAO MANUAL NECESSARIA: recovery ativo (${recovery.failurePhase}). Reinicio bloqueado.`,
    });
  }
  return handleStreamAction(request, reply, {
    action: 'prod-restart',
    label: 'Reiniciar API producao',
    scriptRelative: 'scripts/prod/restart-api.ps1',
    extraLogs: ['api-error.log'],
  });
});

app.get('/api/release', async (request, reply) => {
  try {
    return await buildReleaseState();
  } catch (err) {
    return reply.code(500).send({ error: String(err.message || err) });
  }
});

/** Verificacao pos-deploy somente leitura do passo 5. */
app.get('/api/prod/smoke', async (request, reply) => {
  try {
    const apiPort = PORTS.prodApi;
    const base = `http://127.0.0.1:${apiPort}`;
    const [readyRes, frontRes] = await Promise.all([
      fetch(`${base}/api/ready`).catch(() => null),
      fetch(`${base}/`).catch(() => null),
    ]);

    const deployed = readManifest(PROD_MANIFEST);
    const head = await runGit(['rev-parse', 'HEAD'], PROJECT_ROOT);
    const headSha = head.ok ? head.stdout.trim() : '';
    const deployedSha = deployed?.gitSha || '';
    const manifestAligned = Boolean(
      deployedSha && headSha && (deployedSha === headSha || headSha.startsWith(deployedSha) || deployedSha.startsWith(headSha.slice(0, 7))),
    );

    const logosDir = path.join(PROJECT_ROOT, 'backend', 'uploads-prod', 'logos');
    let logoSample = null;
    if (fs.existsSync(logosDir)) {
      const sampleFile = fs.readdirSync(logosDir).find((name) => name.endsWith('.webp'));
      if (sampleFile) {
        const logoRes = await fetch(`${base}/uploads/logos/${sampleFile}`).catch(() => null);
        const contentType = logoRes?.headers?.get('content-type') || '';
        logoSample = {
          file: sampleFile,
          ok: Boolean(logoRes?.ok && contentType.includes('image')),
          contentType,
        };
      }
    }

    const release = await buildReleaseState();
    const pendingCount = release.pending?.length ?? 0;

    return {
      ready: Boolean(readyRes?.ok),
      frontend: Boolean(frontRes?.ok),
      manifestAligned,
      deployedSha: deployedSha ? deployedSha.slice(0, 7) : null,
      headSha: headSha ? headSha.slice(0, 7) : null,
      pendingCount,
      logoSample,
      ok: Boolean(readyRes?.ok && frontRes?.ok && manifestAligned && pendingCount === 0 && (!logoSample || logoSample.ok)),
    };
  } catch (err) {
    return reply.code(500).send({ error: String(err.message || err) });
  }
});

app.post('/api/prod/deploy', async (request, reply) => {
  if (!requireToken(request, reply)) return;

  const body = request.body || {};
  if (body.confirm !== 'DEPLOY') {
    return reply.code(400).send({ error: 'Digite DEPLOY para confirmar deploy em producao.' });
  }

  // O gate e reavaliado no servidor: o estado pode ter mudado desde que a tela carregou,
  // e a decisao nao pode depender do que o navegador afirma.
  let state;
  try {
    state = await buildReleaseState();
  } catch (err) {
    return reply.code(500).send({ error: `Nao foi possivel verificar a release: ${String(err.message || err)}` });
  }

  const override = body.override === true && body.overrideConfirm === OVERRIDE_CONFIRM;
  if (body.override === true && !override) {
    return reply.code(400).send({
      error: `Para ignorar o gate, envie overrideConfirm com o texto ${OVERRIDE_CONFIRM}.`,
    });
  }
  if (override && !String(body.overrideReason || '').trim()) {
    return reply.code(400).send({ error: 'Informe o motivo do override — ele fica registrado na auditoria.' });
  }

  const gate = evaluateReleaseGate(state, {
    requiredChecks,
    acknowledgeMigrations: body.acknowledgeMigrations === true,
    override,
  });

  if (!gate.allowed) {
    audit(`acao=prod-deploy RECUSADO ${releaseSummaryForAudit(state, gate, body)}`);
    return reply.code(409).send({
      error: 'Deploy recusado pelo gate de release.',
      blockers: gate.blockers,
      warnings: gate.warnings,
    });
  }

  audit(`acao=prod-deploy LIBERADO ${releaseSummaryForAudit(state, gate, body)}`);

  return handleStreamAction(request, reply, {
    action: 'prod-deploy',
    label: gate.overridden ? 'Deploy producao (GATE IGNORADO)' : 'Deploy producao',
    scriptRelative: 'scripts/prod/deploy.ps1',
    psArgs: ['-Confirmed'],
    extraLogs: ['api-error.log'],
  });
});

app.post('/api/prod/rollback', async (request, reply) => {
  if (!requireToken(request, reply)) return;

  const body = request.body || {};
  if (body.confirm !== 'ROLLBACK') {
    return reply.code(400).send({ error: 'Digite ROLLBACK para voltar a release anterior.' });
  }

  const rollback = readRollbackPoint(PROD_ARTIFACTS_PREVIOUS);
  if (!rollback.available) {
    return reply.code(409).send({
      error:
        'Nenhuma release anterior preservada. O rollback fica disponivel a partir do primeiro deploy ' +
        'que salva prod-artifacts.previous.',
    });
  }

  audit(`acao=prod-rollback para=${rollback.gitSha || 'desconhecido'} partes=${(rollback.parts || []).join('|')}`);

  return handleStreamAction(request, reply, {
    action: 'prod-rollback',
    label: 'Rollback producao',
    scriptRelative: 'scripts/prod/rollback.ps1',
    psArgs: ['-Confirmed'],
    extraLogs: ['api-error.log'],
  });
});

app.post('/api/infra/pick-backup-folder', async (request, reply) => {
  if (!requireToken(request, reply)) return;

  try {
    const picked = await runPickBackupFolderScript();
    if (!picked) {
      return { cancelled: true };
    }
    const pathResolved = validateBackupDestination(picked);
    audit(`pick-backup-folder path=${pathResolved}`);
    return { cancelled: false, path: pathResolved };
  } catch (err) {
    return reply.code(500).send({ error: String(err.message || err) });
  }
});

app.post('/api/infra/backup-db', async (request, reply) => {
  let destinationDir = '';
  try {
    destinationDir = validateBackupDestination(request.body?.destinationDir || '');
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }

  const psArgs = destinationDir ? ['-DestinationDir', destinationDir] : [];

  return handleStreamAction(request, reply, {
    action: 'infra-backup-db',
    label: 'Backup banco producao',
    scriptRelative: 'scripts/prod/backup-db.ps1',
    psArgs,
  });
});

app.post('/api/infra/sync-prod-to-dev', async (request, reply) => {
  if (!requireToken(request, reply)) return;

  const body = request.body || {};
  if (body.confirm !== 'SYNC-DEV') {
    return reply.code(400).send({ error: 'Digite SYNC-DEV para confirmar copia prod -> dev.' });
  }

  // O cooldown e aplicado dentro de handleStreamAction; checar aqui tambem faria a
  // segunda chamada encontrar o proprio registro e responder 429 sempre.
  return handleStreamAction(request, reply, {
    action: 'infra-sync-prod-dev',
    label: 'Copiar producao para dev',
    scriptRelative: 'scripts/prod/sync-prod-to-dev.ps1',
    psArgs: ['-Confirmed'],
  });
});

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Rota nao encontrada' });
  }
  return reply.sendFile('index.html');
});

try {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  // Uma segunda instancia (porta alternativa, teste) nao pode roubar o pid da instancia
  // que esta no ar, senao prod:status e stop-all passam a mirar o processo errado.
  const owner = readPid('ops-panel.pid');
  if (owner && owner !== process.pid && isProcessAlive(owner)) {
    console.warn(`ops-panel.pid pertence ao PID ${owner}, que esta vivo. Mantendo o arquivo intacto.`);
  } else {
    fs.writeFileSync(path.join(RUNTIME_DIR, 'ops-panel.pid'), String(process.pid), 'utf8');
  }
} catch {
  // ignore
}

process.on('SIGINT', () => {
  removeOpsPanelMeta();
  process.exit(0);
});
process.on('SIGTERM', () => {
  removeOpsPanelMeta();
  process.exit(0);
});

try {
  await app.listen({ host: HOST, port: PORT });
  writeOpsPanelMeta();
  audit(`ops-panel iniciado em http://${HOST}:${PORT} pid=${process.pid}`);
  console.log(`Quiver Tap Ops Panel: http://${HOST}:${PORT}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
