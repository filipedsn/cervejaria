import { config } from './config.js';
import { enrich } from './enrich.js';
import { esReachable, markTriaged } from './es.js';
import { KILL_SWITCH_FILE, fixerGate } from './killswitch.js';
import { commentOnIssue, createIssue, ensureLabels, findIssueByFingerprint, ghAvailable } from './github.js';
import { log } from './logger.js';
import * as metrics from './metrics.js';
import {
  type AgentState,
  isAlertProcessed,
  loadState,
  markAlertProcessed,
  saveState,
  upsertFingerprint,
} from './state.js';
import { buildDossier, isActionable } from './triage.js';
import { fetchNewAlerts, isRecovery } from './watcher.js';
import type { Alert } from './types.js';

/**
 * Orquestrador do agente de suporte.
 *
 *   npm start          — loop continuo
 *   npm run triage     — um ciclo e sai
 *   npm run shadow     — um ciclo em modo sombra explicito (nunca chama o fixer)
 */

type Cycle = {
  triados: number;
  issuesAbertas: number;
  duplicadas: number;
  infra: number;
  semEvidencia: number;
  elegiveisParaFix: number[];
};

async function handleAlert(alert: Alert, state: AgentState, cycle: Cycle): Promise<AgentState> {
  let next = state;

  if (isRecovery(alert)) {
    log.info('Alerta de recuperacao ignorado', { rule: alert.ruleName, alertId: alert.id });
    return markAlertProcessed(next, alert.id);
  }

  const evidence = await enrich(alert);
  const dossier = buildDossier(alert, evidence);
  cycle.triados += 1;
  metrics.record('support_agent.alertas_triados', 1, { rule: alert.ruleName });

  const verdict = isActionable(dossier);
  const ruleAttrs = { rule: alert.ruleName, kind: dossier.decision.kind };

  if (dossier.decision.kind === 'infra') {
    cycle.infra += 1;
    metrics.record('support_agent.alertas_infra', 1, ruleAttrs);
    log.info('Alerta de infra: segue no fluxo de notificacao, sem Issue', {
      rule: alert.ruleName,
      fingerprint: dossier.fingerprint,
    });
    if (!config.dryRun) await markTriaged(alert.id, null);
    return markAlertProcessed(next, alert.id);
  }

  if (dossier.decision.kind === 'desconhecido') {
    log.warn('Regra nao classificada — nenhuma acao tomada', {
      rule: alert.ruleName,
      hint: 'classifique em support-agent/src/triage.ts',
    });
    if (!config.dryRun) await markTriaged(alert.id, null);
    return markAlertProcessed(next, alert.id);
  }

  const existing = await findIssueByFingerprint(dossier.fingerprint);
  if (existing != null) {
    cycle.duplicadas += 1;
    metrics.record('support_agent.issues_duplicadas', 1, ruleAttrs);
    log.info('Fingerprint ja tem Issue aberta', { issue: existing, fingerprint: dossier.fingerprint });
    if (!config.dryRun) {
      await commentOnIssue(
        existing,
        `Reincidencia em ${alert.timestamp}: o alerta \`${alert.ruleName}\` disparou de novo ` +
          `com o mesmo fingerprint \`${dossier.fingerprint}\`. ` +
          `${evidence.failures.length} logs de falha na janela.`,
      );
      await markTriaged(alert.id, existing);
    }
    next = upsertFingerprint(next, dossier.fingerprint, { issueNumber: existing });
    return markAlertProcessed(next, alert.id);
  }

  if (config.dryRun) {
    log.info('[dry-run] Issue que seria aberta', {
      title: `[auto] ${alert.ruleName}`,
      fingerprint: dossier.fingerprint,
      acionavel: verdict.ok,
      motivo: verdict.reason,
    });
    return markAlertProcessed(next, alert.id);
  }

  // Issue e aberta mesmo quando nao acionavel: e assim que a lacuna do enriquecimento
  // fica visivel durante o modo sombra, em vez de o alerta desaparecer em silencio.
  const issueNumber = await createIssue(dossier);
  cycle.issuesAbertas += 1;
  metrics.record('support_agent.issues_abertas', 1, ruleAttrs);
  log.info('Issue aberta', {
    issue: issueNumber,
    rule: alert.ruleName,
    fingerprint: dossier.fingerprint,
    acionavel: verdict.ok,
  });

  if (!verdict.ok) {
    cycle.semEvidencia += 1;
    metrics.record('support_agent.alertas_sem_evidencia', 1, ruleAttrs);
    await commentOnIssue(
      issueNumber,
      `**Correcao automatica nao sera tentada.**\n\n${verdict.reason}\n\n` +
        'Esta Issue precisa de analise humana. Se o dossie estiver faltando informacao que ' +
        'deveria existir, o ajuste e no enriquecimento (`support-agent/src/enrich.ts`) ou na ' +
        'instrumentacao da aplicacao, nao no agente de correcao.',
    );
  } else {
    cycle.elegiveisParaFix.push(issueNumber);
  }

  await markTriaged(alert.id, issueNumber);
  return upsertFingerprint(markAlertProcessed(next, alert.id), dossier.fingerprint, {
    issueNumber,
  });
}

export async function runCycle(): Promise<Cycle> {
  const cycle: Cycle = {
    triados: 0,
    issuesAbertas: 0,
    duplicadas: 0,
    infra: 0,
    semEvidencia: 0,
    elegiveisParaFix: [],
  };

  let state = loadState();
  const alerts = await fetchNewAlerts(state.lastPollIso);

  if (!alerts.length) {
    log.info('Nenhum alerta novo', { since: state.lastPollIso });
    return cycle;
  }

  log.info(`${alerts.length} alerta(s) novo(s)`, { since: state.lastPollIso });

  let maxTs = state.lastPollIso;
  for (const alert of alerts) {
    if (alert.timestamp > maxTs) maxTs = alert.timestamp;
    if (isAlertProcessed(state, alert.id)) continue;
    try {
      state = await handleAlert(alert, state, cycle);
    } catch (err) {
      log.error('Falha ao triar alerta', {
        alertId: alert.id,
        rule: alert.ruleName,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  state = { ...state, lastPollIso: maxTs };
  saveState(state);
  await metrics.flush();

  log.info('Ciclo concluido', {
    triados: cycle.triados,
    issues: cycle.issuesAbertas,
    duplicadas: cycle.duplicadas,
    infra: cycle.infra,
    semEvidencia: cycle.semEvidencia,
  });

  return cycle;
}

async function preflight(): Promise<boolean> {
  const es = await esReachable();
  log.info(`Elasticsearch: ${es.ok ? 'OK' : 'FALHA'}`, { url: config.es.url, detail: es.detail });
  if (!es.ok) return false;

  if (config.dryRun) {
    log.info('Modo dry-run: nada sera escrito no GitHub nem no Elasticsearch');
    return true;
  }

  const gh = await ghAvailable();
  log.info(`GitHub CLI: ${gh.ok ? 'OK' : 'FALHA'}`, { repo: config.github.repo, detail: gh.detail });
  if (!gh.ok) return false;

  await ensureLabels();
  return true;
}

/**
 * Aciona o fixer se o gate permitir. O gate e consultado a cada ciclo, e nao no boot,
 * para que o kill switch de arquivo tenha efeito num agente que ja esta rodando.
 */
async function maybeFix(issues: number[], shadow: boolean): Promise<void> {
  if (!issues.length) return;

  const gate = fixerGate(shadow);
  if (!gate.enabled) {
    metrics.record('support_agent.fix_suprimido', issues.length, { origem: gate.source });
    log.info('Issues elegiveis para correcao, mas o fixer esta desligado', {
      issues,
      origem: gate.source,
      motivo: gate.reason,
    });
    await metrics.flush();
    return;
  }

  const { runFixerForIssues } = await import('./fixer.js');
  await runFixerForIssues(issues);
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once') || process.argv.includes('--shadow');
  const shadow = config.shadowMode || process.argv.includes('--shadow');
  const gate = fixerGate(shadow);

  log.info('Agente de suporte iniciando', {
    modo: shadow ? 'sombra (somente Issues)' : 'completo',
    fixer: gate.enabled ? 'ligado' : `desligado (${gate.source}: ${gate.reason})`,
    killSwitch: KILL_SWITCH_FILE,
    dryRun: config.dryRun,
    intervaloMs: config.pollIntervalMs,
  });

  if (!(await preflight())) {
    log.error('Pre-checagem falhou. Agente nao vai iniciar.');
    process.exit(1);
  }

  const cycle = await runCycle();
  await maybeFix(cycle.elegiveisParaFix, shadow);

  if (once) return;

  const timer = setInterval(() => {
    void (async () => {
      try {
        const next = await runCycle();
        await maybeFix(next.elegiveisParaFix, shadow);
      } catch (err) {
        log.error('Ciclo falhou', { err: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, config.pollIntervalMs);

  const stop = (signal: string) => {
    log.info(`Recebido ${signal}, encerrando`);
    clearInterval(timer);
    void metrics.flush().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((err) => {
  log.error('Agente abortou', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
