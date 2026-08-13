import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Alert, Dossier, Evidence, SuspectFile, TriageDecision } from './types.js';
import { PROJECT_ROOT, config } from './config.js';

/**
 * Fase 2 — triagem.
 *
 * Duas responsabilidades: decidir se um alerta pode virar bug de codigo (allowlist)
 * e produzir um fingerprint estavel para nao abrir a mesma Issue duas vezes.
 */

/** Regras que descrevem comportamento de aplicacao e podem virar correcao de codigo. */
export const RULE_ALLOWLIST: readonly string[] = [
  'quiver-tap-ui-error-prd',
  'quiver-tap-transacao-failure-prd',
  'quiver-tap-5xx-rate-prd',
];

/**
 * Regras que nao viram correcao de codigo. Continuam no fluxo de Telegram/e-mail do
 * alert-poller. Duas familias:
 *
 * - infraestrutura (banco fora do ar, cluster amarelo, gap de telemetria): nao ha
 *   codigo para corrigir.
 * - SLO e burn rate: sao agregados sobre varios pedidos. Dizem "a saude piorou", nao
 *   "esta linha esta errada". A regra especifica correspondente (por exemplo
 *   quiver-tap-transacao-failure-prd) e que carrega o sinal acionavel.
 */
export const RULE_INFRA: readonly string[] = [
  'quiver-tap-postgres-tcp-down-dev',
  'quiver-tap-postgres-tcp-down-prd',
  'quiver-tap-telemetry-gap-dev',
  'quiver-tap-telemetry-gap-prd',
  'quiver-tap-es-cluster-not-green',
  'quiver-tap-public-ready-down-dev',
  'quiver-tap-public-ready-down-prd',
  'quiver-tap-api-ready-down-prd',
  'quiver-tap-api-down',
  'quiver-tap-api-down-prd',
  'quiver-tap-eventloop-high',
  'quiver-tap-eventloop-high-dev',
  'quiver-tap-eventloop-high-prd',
  'quiver-tap-401-surge-prd',
  'quiver-tap-slo-availability-burn-prd',
  'quiver-tap-slo-transacao-failure-rate-prd',
  'quiver-tap-slo-cozinha-slow-prd',
];

export function classify(alert: Alert): TriageDecision {
  const rule = alert.ruleName;
  if (RULE_ALLOWLIST.includes(rule)) return { kind: 'codigo', rule };
  if (RULE_INFRA.includes(rule)) {
    return {
      kind: 'infra',
      rule,
      reason: 'Regra de infraestrutura: segue no fluxo de Telegram/e-mail, sem correcao de codigo.',
    };
  }
  return {
    kind: 'desconhecido',
    rule,
    reason:
      'Regra nao classificada. Adicione a RULE_ALLOWLIST (bug de codigo) ou a RULE_INFRA ' +
      'em support-agent/src/triage.ts antes que o agente atue sobre ela.',
  };
}

/** Primeiro frame do stack que aponta para codigo nosso, ignorando node_modules e runtime. */
export function firstOwnFrame(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    if (trimmed.includes('node_modules')) continue;
    if (trimmed.includes('node:internal')) continue;
    const match = /((?:[A-Za-z]:)?[^()\s]*?(?:src|dist)[\\/][^()\s]*?\.(?:ts|js|tsx)):(\d+)/.exec(trimmed);
    if (match) return `${match[1]}:${match[2]}`;
  }
  return undefined;
}

/**
 * Fingerprint = regra + acao do evento + primeiro frame proprio do stack.
 * Sem stack, cai para a rota HTTP; sem rota, so a regra. Quanto menos sinal,
 * mais grosseiro o agrupamento — e por isso o dossie registra o gap.
 */
export function fingerprint(alert: Alert, evidence: Evidence): string {
  const parts = [alert.ruleName];

  const action = evidence.byAction[0]?.action ?? evidence.failures[0]?.eventAction;
  if (action) parts.push(action);

  const frame = firstOwnFrame(evidence.stack);
  if (frame) parts.push(normalizeFrame(frame));
  else if (evidence.byRoute[0]?.route) parts.push(evidence.byRoute[0].route);

  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
  return `${alert.ruleName}:${digest}`;
}

/** Remove o caminho absoluto da maquina para o fingerprint nao mudar entre hosts. */
function normalizeFrame(frame: string): string {
  return frame.replace(/\\/g, '/').replace(/^.*?\/(src|dist)\//, '$1/');
}

/** Um caminho candidato existe no repositorio? Injetavel para manter os testes puros. */
export type FileExists = (relativePath: string) => boolean;

const existsInRepo: FileExists = (relativePath) =>
  fs.existsSync(path.join(PROJECT_ROOT, relativePath));

/**
 * Arquivos que provavelmente contem o bug, derivados do stack e da rota.
 *
 * Candidatos que nao existem no repositorio sao descartados: `routeToFiles` gera
 * combinacoes plausiveis pela convencao de nomes, e listar caminhos inexistentes no
 * dossie manda o agente de correcao procurar arquivo que nunca houve.
 */
export function suspectFiles(evidence: Evidence, exists: FileExists = existsInRepo): SuspectFile[] {
  const suspects = new Map<string, string>();

  const frame = firstOwnFrame(evidence.stack);
  if (frame) {
    const normalized = normalizeFrame(frame).replace(/^dist\//, 'src/').replace(/\.js:/, '.ts:');
    const fromStack = `backend/${normalized.split(':')[0]}`;
    suspects.set(fromStack, 'primeiro frame proprio do stack trace');
  }

  for (const { route } of evidence.byRoute) {
    for (const candidate of routeToFiles(route)) {
      if (suspects.has(candidate)) continue;
      if (!exists(candidate)) continue;
      suspects.set(candidate, `rota ${route}`);
    }
  }

  return [...suspects.entries()].map(([suspectPath, why]) => ({ path: suspectPath, why }));
}

/**
 * Mapeia rota HTTP para o arquivo de rota do Fastify. Convencao do repo:
 * /api/comandas -> backend/src/routes/comandas.ts
 * /api/quiosque/caixa -> backend/src/routes/quiosque/caixa.ts
 */
export function routeToFiles(route: string): string[] {
  const cleaned = route.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
  if (!cleaned) return [];
  const segments = cleaned
    .split('/')
    .filter((s) => s && !s.startsWith(':') && !s.startsWith('*') && !/^\d/.test(s));
  if (!segments.length) return [];

  const candidates: string[] = [];
  if (segments.length >= 2) {
    candidates.push(`backend/src/routes/${segments[0]}/${segments[1]}.ts`);
    candidates.push(`backend/src/lib/${segments[0]}/${segments[1]}.ts`);
  }
  candidates.push(`backend/src/routes/${segments[0]}.ts`);
  candidates.push(`backend/src/lib/${segments[0]}.ts`);
  return candidates;
}

function kibanaLogsLink(evidence: Evidence): string {
  const from = encodeURIComponent(evidence.windowFrom);
  const to = encodeURIComponent(evidence.windowTo);
  return `${config.kibana.url}/app/discover#/?_g=(time:(from:'${from}',to:'${to}'))`;
}

function kibanaTraceLink(traceId: string | undefined): string | undefined {
  if (!traceId) return undefined;
  return `${config.kibana.url}/app/apm/traces?kuery=trace.id:%22${encodeURIComponent(traceId)}%22`;
}

export function buildDossier(alert: Alert, evidence: Evidence, exists?: FileExists): Dossier {
  return {
    alert,
    evidence,
    decision: classify(alert),
    fingerprint: fingerprint(alert, evidence),
    suspects: suspectFiles(evidence, exists),
    kibanaLinks: {
      alert: alert.viewInAppUrl || undefined,
      logs: kibanaLogsLink(evidence),
      trace: kibanaTraceLink(evidence.traceId),
    },
  };
}

/**
 * O dossie sustenta uma tentativa de correcao automatica?
 * Sem stack nem rota o agente estaria adivinhando, e adivinhar gera PR ruim.
 */
export function isActionable(dossier: Dossier): { ok: boolean; reason?: string } {
  if (dossier.decision.kind !== 'codigo') {
    return { ok: false, reason: dossier.decision.kind === 'infra' ? dossier.decision.reason : dossier.decision.reason };
  }
  if (!dossier.evidence.serverFailureCount) {
    return {
      ok: false,
      reason: dossier.evidence.gap ?? 'Nenhuma falha de servidor correlacionada ao alerta.',
    };
  }
  if (!dossier.evidence.stack && !dossier.evidence.byRoute.length) {
    return {
      ok: false,
      reason:
        'Sem stack trace e sem rota HTTP nos logs de falha. Nao ha ponto de partida ' +
        'confiavel no codigo — corrigir aqui seria adivinhar.',
    };
  }
  return { ok: true };
}
