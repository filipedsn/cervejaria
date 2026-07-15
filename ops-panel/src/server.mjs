import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

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
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function audit(message) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(AUDIT_LOG, line, 'utf8');
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
  } catch {
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
  if (!OPS_TOKEN) {
    reply.code(503).send({ error: 'OPS_PANEL_TOKEN nao configurado em ops-panel/.env' });
    return false;
  }
  const header = request.headers['x-ops-token'];
  if (header !== OPS_TOKEN) {
    reply.code(401).send({ error: 'Token invalido. Salve o token do ops-panel/.env no campo acima.' });
    return false;
  }
  return true;
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

app.get('/api/logs', async () => ({
  files: Object.keys(LOG_FILES).map((name) => {
    const meta = logMeta(name);
    return { name, label: meta.label, description: meta.description };
  }),
}));

app.get('/api/status', async () => {
  const [prodReady, prodHealth, prodFrontend, devApi, devFrontend] = await Promise.all([
    checkHttp(`http://127.0.0.1:${PORTS.prodApi}/api/ready`),
    checkHttp(`http://127.0.0.1:${PORTS.prodApi}/api/health`),
    checkHttp(`http://127.0.0.1:${PORTS.prodApi}/`),
    checkHttp(`http://127.0.0.1:${PORTS.devApi}/api/health`),
    checkHttp(`http://127.0.0.1:${PORTS.devFrontend}/`),
  ]);

  const apiPid = readPid('api.pid');
  const watchdogPid = readPid('watchdog.pid');
  const opsPid = readPid('ops-panel.pid');
  const devSupervisorPid = readPid('dev-supervisor.pid');

  const ci = await githubSummary();

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
  return handleStreamAction(request, reply, {
    action: 'prod-restart',
    label: 'Reiniciar API producao',
    scriptRelative: 'scripts/prod/restart-api.ps1',
    extraLogs: ['api-error.log'],
  });
});

app.post('/api/prod/deploy', async (request, reply) => {
  if (!requireToken(request, reply)) return;

  const body = request.body || {};
  if (body.confirm !== 'DEPLOY') {
    return reply.code(400).send({ error: 'Digite DEPLOY para confirmar deploy em producao.' });
  }
  if (!checkCooldown('prod-deploy', reply)) return;

  return handleStreamAction(request, reply, {
    action: 'prod-deploy',
    label: 'Deploy producao',
    scriptRelative: 'scripts/prod/deploy.ps1',
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
  if (!checkCooldown('infra-sync-prod-dev', reply)) return;

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
  fs.writeFileSync(path.join(RUNTIME_DIR, 'ops-panel.pid'), String(process.pid), 'utf8');
} catch {
  // ignore
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

try {
  await app.listen({ host: HOST, port: PORT });
  audit(`ops-panel iniciado em http://${HOST}:${PORT} pid=${process.pid}`);
  console.log(`Quiver Tap Ops Panel: http://${HOST}:${PORT}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
