/**
 * Relatorio de eficacia do agente.
 *
 *   npm run agent:report
 *
 * Serve a dois momentos:
 * - Fase 2 (modo sombra): o dossie esta bom o suficiente para embasar uma correcao?
 *   A coluna "acionavel" e a resposta. Se a maioria das Issues nao for acionavel,
 *   o problema esta no enriquecimento ou na instrumentacao, nao no agente de correcao.
 * - Fase 5 (revisao semanal): cada PR rejeitado indica lacuna na skill ou no dossie.
 */
import { dailyRunLimit, estimatedCostUsd } from './circuit-breaker.js';
import { config } from './config.js';
import { run } from './shell.js';
import { loadState } from './state.js';

type Issue = {
  number: number;
  title: string;
  body: string;
  state: string;
  createdAt: string;
  closedAt: string | null;
  labels: { name: string }[];
};

type Pull = {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  headRefName: string;
};

function ghEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (config.github.token) env.GH_TOKEN = config.github.token;
  return env;
}

async function ghJson<T>(args: string[]): Promise<T[]> {
  const result = await run('gh', args, { env: ghEnv(), timeoutMs: 60_000 });
  if (result.code !== 0) return [];
  try {
    return JSON.parse(result.stdout) as T[];
  } catch {
    return [];
  }
}

function section(title: string): void {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

function pct(part: number, total: number): string {
  if (!total) return '—';
  return `${Math.round((part / total) * 100)}%`;
}

async function main(): Promise<void> {
  const days = Number.parseInt(process.argv[2] ?? '7', 10);
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);

  console.log(`Relatorio do agente de suporte — ultimos ${days} dias (${config.github.repo})`);

  const issues = (
    await ghJson<Issue>([
      'issue',
      'list',
      '--repo',
      config.github.repo,
      '--state',
      'all',
      '--label',
      'auto-triagem',
      '--limit',
      '200',
      '--json',
      'number,title,body,state,createdAt,closedAt,labels',
    ])
  ).filter((i) => new Date(i.createdAt) >= since);

  const pulls = (
    await ghJson<Pull>([
      'pr',
      'list',
      '--repo',
      config.github.repo,
      '--state',
      'all',
      '--limit',
      '200',
      '--json',
      'number,title,state,createdAt,mergedAt,closedAt,headRefName',
    ])
  ).filter((p) => p.headRefName.startsWith('fix/auto-') && new Date(p.createdAt) >= since);

  section('Triagem');
  const naoAcionaveis = issues.filter((i) =>
    /Correcao automatica nao sera tentada|Nenhum stack trace|nenhuma falha de servidor/i.test(i.body),
  );
  const acionaveis = issues.length - naoAcionaveis.length;
  console.log(`Issues abertas pelo agente     ${issues.length}`);
  console.log(`  com dossie acionavel         ${acionaveis} (${pct(acionaveis, issues.length)})`);
  console.log(`  sem evidencia suficiente     ${naoAcionaveis.length} (${pct(naoAcionaveis.length, issues.length)})`);
  console.log(`Issues fechadas                ${issues.filter((i) => i.state === 'CLOSED').length}`);

  section('Correcao automatica');
  const merged = pulls.filter((p) => p.mergedAt);
  const rejeitados = pulls.filter((p) => !p.mergedAt && p.closedAt);
  const abertos = pulls.filter((p) => p.state === 'OPEN');
  console.log(`PRs automaticos                ${pulls.length}`);
  console.log(`  aprovados por voce (merged)  ${merged.length} (${pct(merged.length, pulls.length)})`);
  console.log(`  rejeitados (fechados)        ${rejeitados.length} (${pct(rejeitados.length, pulls.length)})`);
  console.log(`  aguardando revisao           ${abertos.length}`);

  if (rejeitados.length) {
    section('PRs rejeitados — revisar a lacuna');
    for (const pr of rejeitados) {
      console.log(`  #${pr.number} ${pr.title}`);
    }
    console.log('');
    console.log('Cada rejeicao indica lacuna na skill (.cursor/skills/quiver-tap-bugfix)');
    console.log('ou no dossie (support-agent/src/enrich.ts). E assim que o agente melhora.');
  }

  section('Estado local');
  const state = loadState();
  const fingerprints = Object.values(state.fingerprints);
  const desistencias = fingerprints.filter((f) => f.lastGiveUpReason);
  console.log(`Fingerprints conhecidos        ${fingerprints.length}`);
  console.log(`  com tentativa de correcao    ${fingerprints.filter((f) => f.fixAttempts > 0).length}`);
  console.log(`  esgotaram as tentativas      ${fingerprints.filter((f) => f.fixAttempts >= config.fixer.maxAttemptsPerFingerprint).length}`);
  console.log(`PRs hoje                       ${state.today.prsOpened} de ${config.fixer.maxPrsPerDay}`);
  const limit = dailyRunLimit();
  console.log(`Execucoes do CLI hoje          ${state.today.runs} de ${limit.runs} (limitado por ${limit.boundBy})`);
  console.log(`Tempo de CLI hoje              ${(state.today.cliDurationMs / 60_000).toFixed(1)} min`);
  console.log(
    `Custo estimado hoje            US$ ${estimatedCostUsd(state.today.runs).toFixed(2)} de ` +
      `US$ ${config.fixer.maxCostUsdPerDay.toFixed(2)} (estimativa: o CLI nao reporta custo)`,
  );

  if (desistencias.length) {
    section('Fingerprints abandonados');
    for (const f of desistencias) {
      console.log(`  ${f.fingerprint} — ${f.lastGiveUpReason}`);
    }
  }

  section('Veredito do modo sombra');
  if (!issues.length) {
    console.log('Sem Issues no periodo. Nada a avaliar — mantenha o modo sombra.');
  } else if (acionaveis / issues.length < 0.5) {
    console.log(`Apenas ${pct(acionaveis, issues.length)} das Issues tem dossie acionavel.`);
    console.log('NAO libere a correcao automatica ainda. Melhore o enriquecimento primeiro:');
    console.log('  - a aplicacao esta logando stack trace em falha? (attributes.metadata.stack)');
    console.log('  - existe log de nivel error em producao, ou tudo vira info?');
  } else {
    console.log(`${pct(acionaveis, issues.length)} das Issues tem dossie acionavel.`);
    console.log('O enriquecimento sustenta uma tentativa de correcao. Para ligar a Fase 3:');
    console.log('  SUPPORT_AGENT_SHADOW=false e SUPPORT_AGENT_FIXER_ENABLED=true em support-agent/.env');
  }
  console.log('');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
