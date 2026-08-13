import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Parametros expostos no ops-panel com descricao e tipo de controle. */
export const AGENT_CONTROLS = [
  {
    id: 'monitoring',
    type: 'process',
    label: 'Monitoramento continuo',
    description:
      'Mantem o processo do agente no ar, consultando o indice quiver-tap-alert-events no Elasticsearch a cada intervalo configurado (padrao 60s). Desligado, nenhum alerta novo e triado.',
  },
  {
    id: 'shadow',
    envKey: 'SUPPORT_AGENT_SHADOW',
    type: 'boolean',
    default: true,
    label: 'Modo sombra',
    description:
      'Fase 2 do plano: abre Issues enriquecidas no GitHub e nunca aciona o fixer. Recomendado por 1–2 semanas para avaliar a qualidade do dossie antes de liberar correcao automatica.',
  },
  {
    id: 'dryRun',
    envKey: 'SUPPORT_AGENT_DRY_RUN',
    type: 'boolean',
    default: false,
    label: 'Dry-run',
    description:
      'Simula triagem e mostra no log o que faria, sem criar Issue no GitHub nem marcar alertas como triados no Elasticsearch. Util para validar enriquecimento antes de ir ao ar.',
  },
  {
    id: 'fixerEnabled',
    envKey: 'SUPPORT_AGENT_FIXER_ENABLED',
    type: 'boolean',
    default: false,
    label: 'Correcao automatica (fixer)',
    description:
      'Permite o Cursor CLI corrigir bugs em worktree isolado (C:\\quiver-agent-work) e abrir PR fix/auto-N. Exige modo sombra desligado, kill switch inativo e CURSOR_API_KEY configurada.',
    requires: { shadow: false },
  },
  {
    id: 'killSwitch',
    type: 'killswitch',
    label: 'Fixer liberado (sem kill switch)',
    description:
      'Quando desligado, aciona o kill switch de emergencia: a correcao automatica para imediatamente, mas a triagem continua. Equivale ao arquivo deploy/runtime/support-agent-fixer.disabled.',
    inverted: true,
  },
  {
    id: 'otlpMetrics',
    envKey: 'SUPPORT_AGENT_OTLP_ENDPOINT',
    type: 'otlp',
    defaultEndpoint: 'http://127.0.0.1:4318',
    label: 'Metricas OTLP',
    description:
      'Exporta contadores do agente (alertas triados, Issues, PRs, circuit breakers) para o collector OpenTelemetry local. Alimenta o dashboard Quiver Tap Agente de Suporte no Kibana.',
  },
];

export function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseEnvFile(content) {
  const vars = {};
  if (!content) return vars;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

export function envBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const raw = String(value).trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return fallback;
}

export function setEnvVar(content, key, value) {
  const normalized = String(value);
  const lines = (content || '').split('\n');
  let found = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return line;
    const k = trimmed.slice(0, eq).trim();
    if (k !== key) return line;
    found = true;
    return `${key}=${normalized}`;
  });
  if (!found) {
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push(`${key}=${normalized}`);
  }
  return `${out.join('\n').replace(/\n?$/, '\n')}`;
}

export function formatAgePt(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  return `${(ms / 86_400_000).toFixed(1)} dias`;
}

export function isProcessAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'EPERM') return true;
    return false;
  }
}

export function readKillSwitch(killSwitchFile) {
  if (!fs.existsSync(killSwitchFile)) {
    return { active: false, reason: '' };
  }
  try {
    const reason = fs.readFileSync(killSwitchFile, 'utf8').trim();
    return { active: true, reason: reason || 'sem motivo registrado' };
  } catch {
    return { active: true, reason: 'arquivo ilegivel' };
  }
}

export function setKillSwitch(killSwitchFile, active, reason = 'desligado pelo ops-panel') {
  if (!active) {
    if (fs.existsSync(killSwitchFile)) fs.rmSync(killSwitchFile);
    return;
  }
  fs.mkdirSync(path.dirname(killSwitchFile), { recursive: true });
  const stamp = new Date().toISOString();
  fs.writeFileSync(killSwitchFile, `${reason} (${stamp})\n`, 'utf8');
}

export function fixerEffective({ shadow, fixerEnabled, killSwitchActive }) {
  if (killSwitchActive) return { enabled: false, reason: 'kill switch ativo' };
  if (shadow) return { enabled: false, reason: 'modo sombra' };
  if (!fixerEnabled) return { enabled: false, reason: 'fixer desligado na config' };
  return { enabled: true, reason: 'ligado' };
}

/**
 * KPI de saude geral: 0–100 com nivel saudavel | atencao | critico.
 * Pensado para o operador ver de relance se o agente esta cumprindo o papel.
 */
export function evaluateAgentHealth(snapshot) {
  const checks = [];
  let score = 100;

  const { process: proc, elasticsearch: es, config, state, killSwitch, gh } = snapshot;

  if (!proc.running) {
    checks.push({
      id: 'processo',
      status: 'warn',
      message: 'Agente parado — o Elastic nao esta sendo monitorado agora.',
    });
    score -= 45;
  } else {
    checks.push({
      id: 'processo',
      status: 'ok',
      message: `Processo no ar (PID ${proc.pid}).`,
    });
  }

  if (!es.ok) {
    checks.push({
      id: 'elastic',
      status: 'bad',
      message: es.error || 'Elasticsearch inacessivel — triagem impossivel.',
    });
    score -= 35;
  } else {
    checks.push({
      id: 'elastic',
      status: 'ok',
      message: `Elasticsearch OK${es.detail ? ` (${es.detail})` : ''}.`,
    });
  }

  if (proc.running) {
    if (!state?.lastPollIso) {
      checks.push({
        id: 'poll',
        status: 'warn',
        message: 'Nenhum poll registrado ainda.',
      });
      score -= 10;
    } else {
      const ageMs = Date.now() - new Date(state.lastPollIso).getTime();
      const limit = Math.max(config.pollIntervalMs * 2.5, 120_000);
      if (ageMs > limit) {
        checks.push({
          id: 'poll',
          status: 'warn',
          message: `Ultimo poll ha ${formatAgePt(ageMs)} — esperado a cada ${Math.round(config.pollIntervalMs / 1000)}s.`,
        });
        score -= 20;
      } else {
        checks.push({
          id: 'poll',
          status: 'ok',
          message: `Ultimo poll ha ${formatAgePt(ageMs)}.`,
        });
      }
    }
  }

  if (config.dryRun) {
    checks.push({
      id: 'dry-run',
      status: 'warn',
      message: 'Dry-run ligado — nenhuma Issue e criada no GitHub.',
    });
    score -= 12;
  }

  if (config.shadow) {
    checks.push({
      id: 'sombra',
      status: 'info',
      message: 'Modo sombra — triagem ativa, correcao automatica bloqueada.',
    });
    score -= 3;
  }

  if (killSwitch.active) {
    checks.push({
      id: 'kill-switch',
      status: 'warn',
      message: `Kill switch: ${killSwitch.reason}`,
    });
    score -= 8;
  }

  if (!gh.ok && !config.dryRun) {
    checks.push({
      id: 'github',
      status: 'warn',
      message: gh.error || 'gh CLI indisponivel — Issues nao serao abertas.',
    });
    score -= 10;
  } else if (!config.dryRun && gh.ok) {
    checks.push({ id: 'github', status: 'ok', message: 'GitHub CLI autenticado.' });
  }

  if (config.fixerEnabled && config.shadow) {
    checks.push({
      id: 'config',
      status: 'warn',
      message: 'Fixer ligado na config, mas modo sombra o impede — revise os toggles.',
    });
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 80 ? 'saudavel' : score >= 50 ? 'atencao' : 'critico';
  const label =
    level === 'saudavel' ? 'Saudavel' : level === 'atencao' ? 'Atencao' : 'Critico';

  return { score, level, label, checks };
}

export function buildConfigFromEnv(vars, killSwitch) {
  const pollIntervalMs = Number.parseInt(vars.SUPPORT_AGENT_POLL_INTERVAL_MS || '60000', 10);
  const shadow = envBool(vars.SUPPORT_AGENT_SHADOW, true);
  const fixerEnabled = envBool(vars.SUPPORT_AGENT_FIXER_ENABLED, false);
  const dryRun = envBool(vars.SUPPORT_AGENT_DRY_RUN, false);
  const otlpEndpoint = (vars.SUPPORT_AGENT_OTLP_ENDPOINT || '').trim();

  return {
    shadow,
    fixerEnabled,
    dryRun,
    pollIntervalMs: Number.isFinite(pollIntervalMs) ? pollIntervalMs : 60_000,
    otlpEnabled: Boolean(otlpEndpoint),
    otlpEndpoint,
    fixerEffective: fixerEffective({
      shadow,
      fixerEnabled,
      killSwitchActive: killSwitch.active,
    }),
  };
}

export function controlsFromConfig(config, processRunning, killSwitch) {
  return AGENT_CONTROLS.map((ctrl) => {
    if (ctrl.type === 'process') {
      return { ...ctrl, value: processRunning, disabled: false };
    }
    if (ctrl.type === 'killswitch') {
      const engaged = killSwitch.active;
      return {
        ...ctrl,
        value: ctrl.inverted ? !engaged : engaged,
        engaged,
        reason: killSwitch.reason,
        disabled: false,
      };
    }
    if (ctrl.type === 'otlp') {
      return { ...ctrl, value: config.otlpEnabled, disabled: false };
    }
    if (ctrl.envKey === 'SUPPORT_AGENT_SHADOW') {
      return { ...ctrl, value: config.shadow, disabled: false };
    }
    if (ctrl.envKey === 'SUPPORT_AGENT_DRY_RUN') {
      return { ...ctrl, value: config.dryRun, disabled: false };
    }
    if (ctrl.envKey === 'SUPPORT_AGENT_FIXER_ENABLED') {
      const disabled = config.shadow;
      return {
        ...ctrl,
        value: config.fixerEnabled,
        disabled,
        disabledReason: disabled ? 'Desligue o modo sombra primeiro.' : '',
      };
    }
    return ctrl;
  });
}

export async function probeElasticsearch(esUrl, authHeader) {
  try {
    const headers = { Accept: 'application/json' };
    if (authHeader) headers.Authorization = authHeader;
    const res = await fetch(`${esUrl.replace(/\/$/, '')}/_cluster/health`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    return { ok: true, detail: `cluster ${body.status}` };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

export function probeGh(projectRoot) {
  const result = spawnSync('gh', ['auth', 'status'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 8000,
    shell: process.platform === 'win32',
  });
  if (result.status === 0) return { ok: true };
  const err = (result.stderr || result.stdout || '').trim().split('\n')[0];
  return { ok: false, error: err || `exit ${result.status}` };
}

export function readAgentLogTail(logFile, lines = 8) {
  if (!fs.existsSync(logFile)) return [];
  const content = fs.readFileSync(logFile, 'utf8');
  return content.split('\n').filter(Boolean).slice(-lines);
}

export function applyConfigPatch(envContent, patch, defaultOtlpEndpoint) {
  let next = envContent || '';
  const applied = {};

  if (patch.shadow != null) {
    next = setEnvVar(next, 'SUPPORT_AGENT_SHADOW', patch.shadow ? 'true' : 'false');
    applied.shadow = patch.shadow;
  }
  if (patch.dryRun != null) {
    next = setEnvVar(next, 'SUPPORT_AGENT_DRY_RUN', patch.dryRun ? 'true' : 'false');
    applied.dryRun = patch.dryRun;
  }
  if (patch.fixerEnabled != null) {
    next = setEnvVar(next, 'SUPPORT_AGENT_FIXER_ENABLED', patch.fixerEnabled ? 'true' : 'false');
    applied.fixerEnabled = patch.fixerEnabled;
  }
  if (patch.otlpMetrics != null) {
    const endpoint = patch.otlpMetrics ? defaultOtlpEndpoint : '';
    next = setEnvVar(next, 'SUPPORT_AGENT_OTLP_ENDPOINT', endpoint);
    applied.otlpMetrics = patch.otlpMetrics;
  }

  return { content: next, applied };
}

function elasticAuthFromVars(vars, obsVars) {
  const apiKey = vars.SUPPORT_AGENT_ES_API_KEY || obsVars.ELASTIC_API_KEY_SUPPORT_AGENT || obsVars.ELASTIC_API_KEY || '';
  if (apiKey) return `ApiKey ${apiKey}`;
  const pass = vars.SUPPORT_AGENT_ES_PASSWORD || obsVars.ELASTIC_PASSWORD || '';
  const user = vars.SUPPORT_AGENT_ES_USER || obsVars.ELASTIC_USER || 'elastic';
  if (pass) {
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }
  return '';
}

/** Le estado completo para GET /api/support-agent. */
export async function collectSupportAgentSnapshot(projectRoot) {
  const agentDir = path.join(projectRoot, 'support-agent');
  const envFile = path.join(agentDir, '.env');
  const obsEnvFile = path.join(projectRoot, 'deploy', 'observability', '.env.observability');
  const pidFile = path.join(projectRoot, 'deploy', 'runtime', 'support-agent.pid');
  const stateFile = path.join(projectRoot, 'deploy', 'runtime', 'support-agent-state.json');
  const killSwitchFile = path.join(projectRoot, 'deploy', 'runtime', 'support-agent-fixer.disabled');
  const logFile = path.join(projectRoot, 'deploy', 'logs', 'support-agent.log');

  const envContent = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '') : '';
  const obsContent = fs.existsSync(obsEnvFile)
    ? fs.readFileSync(obsEnvFile, 'utf8').replace(/^\uFEFF/, '')
    : '';
  const vars = { ...parseEnvFile(obsContent), ...parseEnvFile(envContent) };
  const killSwitch = readKillSwitch(killSwitchFile);
  const config = buildConfigFromEnv(vars, killSwitch);

  let pid = null;
  let running = false;
  if (fs.existsSync(pidFile)) {
    pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    running = isProcessAlive(pid);
  }

  const state = readJsonFile(stateFile);
  const esUrl = vars.SUPPORT_AGENT_ES_URL || vars.KIBANA_ALERT_ES_URL || 'http://127.0.0.1:9200';
  const authHeader = elasticAuthFromVars(vars, parseEnvFile(obsContent));

  const [elasticsearch, gh] = await Promise.all([
    probeElasticsearch(esUrl, authHeader),
    Promise.resolve(probeGh(projectRoot)),
  ]);

  const snapshot = {
    process: { running, pid: running ? pid : null },
    config,
    state: state
      ? {
          lastPollIso: state.lastPollIso || null,
          processedCount: Array.isArray(state.processedAlertIds) ? state.processedAlertIds.length : 0,
          fingerprintCount: state.fingerprints ? Object.keys(state.fingerprints).length : 0,
          prsToday: state.today?.prsOpened ?? 0,
          runsToday: state.today?.runs ?? 0,
        }
      : null,
    killSwitch,
    elasticsearch,
    gh,
    logTail: readAgentLogTail(logFile),
    envFileExists: fs.existsSync(envFile),
  };

  const health = evaluateAgentHealth(snapshot);
  const controls = controlsFromConfig(config, running, killSwitch);

  return { ...snapshot, health, controls };
}
