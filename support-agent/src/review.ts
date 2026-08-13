import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_ROOT, config } from './config.js';
import * as metrics from './metrics.js';
import { run } from './shell.js';
import { isPrReviewed, loadState, markPrsReviewed, saveState } from './state.js';

/**
 * Fase 5 — revisao semanal dos PRs automaticos.
 *
 *   npm run agent:review          (ultimos 7 dias)
 *   npm run agent:review -- 14    (ultimos 14 dias)
 *
 * Duas coisas acontecem aqui:
 *
 * 1. O desfecho de cada PR automatico (merge ou rejeicao) vira metrica, uma vez por PR.
 *    Sem isso o dashboard mostra quantos PRs o agente abriu, mas nao se eles servem.
 * 2. Cada rejeicao gera uma entrada no relatorio com o campo "lacuna" em branco, para
 *    voce escrever em uma linha o que faltou. Rejeicao sem diagnostico anotado nao
 *    ensina nada ao agente — e a proxima correcao repete o erro.
 */

type Pull = {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  headRefName: string;
  url: string;
  body: string;
};

type Comment = { author: { login: string } | null; body: string; createdAt: string };

const REPORT_DIR = path.join(PROJECT_ROOT, 'deploy', 'reports', 'support-agent');

function ghEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (config.github.token) env.GH_TOKEN = config.github.token;
  return env;
}

async function ghJson<T>(args: string[]): Promise<T | null> {
  const result = await run('gh', args, { env: ghEnv(), timeoutMs: 60_000 });
  if (result.code !== 0) return null;
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}

function fingerprintOf(body: string): string {
  return /Fingerprint:\s*`([^`]+)`/.exec(body)?.[1] ?? 'desconhecido';
}

function issueOf(body: string): string {
  return /Closes #(\d+)/.exec(body)?.[1] ?? '?';
}

/** Comentarios humanos: os do proprio agente nao explicam a rejeicao. */
async function humanComments(prNumber: number): Promise<Comment[]> {
  const data = await ghJson<{ comments: Comment[]; reviews: Comment[] }>([
    'pr',
    'view',
    String(prNumber),
    '--repo',
    config.github.repo,
    '--json',
    'comments,reviews',
  ]);
  if (!data) return [];
  return [...(data.comments ?? []), ...(data.reviews ?? [])]
    .filter((c) => c.body?.trim())
    .filter((c) => !/agente de suporte|PR automatico aberto/i.test(c.body));
}

async function main(): Promise<void> {
  const days = Number.parseInt(process.argv[2] ?? '7', 10);
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);

  const pulls =
    (await ghJson<Pull[]>([
      'pr',
      'list',
      '--repo',
      config.github.repo,
      '--state',
      'all',
      '--limit',
      '200',
      '--json',
      'number,title,state,createdAt,mergedAt,closedAt,headRefName,url,body',
    ])) ?? [];

  const autos = pulls.filter(
    (p) => p.headRefName.startsWith('fix/auto-') && new Date(p.createdAt) >= since,
  );
  const merged = autos.filter((p) => p.mergedAt);
  const rejeitados = autos.filter((p) => !p.mergedAt && p.closedAt);
  const abertos = autos.filter((p) => p.state === 'OPEN');

  let state = loadState();
  const novosDesfechos = [...merged, ...rejeitados].filter((p) => !isPrReviewed(state, p.number));
  for (const pr of novosDesfechos) {
    metrics.record(pr.mergedAt ? 'support_agent.prs_aprovados' : 'support_agent.prs_rejeitados', 1, {
      fingerprint: fingerprintOf(pr.body ?? ''),
    });
  }
  if (novosDesfechos.length) {
    state = markPrsReviewed(state, novosDesfechos.map((p) => p.number));
    saveState(state);
    await metrics.flush();
  }

  const linhas: string[] = [];
  const hoje = new Date().toISOString().slice(0, 10);
  linhas.push(`# Revisao semanal do agente de suporte — ${hoje}`);
  linhas.push('');
  linhas.push(`Janela: ultimos ${days} dias · repo \`${config.github.repo}\``);
  linhas.push('');
  linhas.push('## Numeros');
  linhas.push('');
  linhas.push(`- PRs automaticos: ${autos.length}`);
  linhas.push(`- Aprovados (merge): ${merged.length}`);
  linhas.push(`- Rejeitados (fechados sem merge): ${rejeitados.length}`);
  linhas.push(`- Aguardando sua revisao: ${abertos.length}`);
  linhas.push(`- Desfechos contabilizados nesta execucao: ${novosDesfechos.length}`);
  linhas.push('');

  if (abertos.length) {
    linhas.push('## Aguardando revisao');
    linhas.push('');
    for (const pr of abertos) {
      linhas.push(`- [#${pr.number}](${pr.url}) ${pr.title} — aberto em ${pr.createdAt.slice(0, 10)}`);
    }
    linhas.push('');
  }

  if (rejeitados.length) {
    linhas.push('## Rejeitados — preencher a lacuna');
    linhas.push('');
    for (const pr of rejeitados) {
      const comentarios = await humanComments(pr.number);
      linhas.push(`### [#${pr.number}](${pr.url}) ${pr.title}`);
      linhas.push('');
      linhas.push(`- Issue de origem: #${issueOf(pr.body ?? '')}`);
      linhas.push(`- Fingerprint: \`${fingerprintOf(pr.body ?? '')}\``);
      linhas.push(`- Fechado em: ${pr.closedAt?.slice(0, 10) ?? '?'}`);
      if (comentarios.length) {
        linhas.push('- Comentarios na revisao:');
        for (const c of comentarios.slice(0, 5)) {
          const autor = c.author?.login ?? 'desconhecido';
          linhas.push(`  - **${autor}**: ${c.body.trim().replace(/\s+/g, ' ').slice(0, 240)}`);
        }
      } else {
        linhas.push('- Comentarios na revisao: nenhum (o motivo da rejeicao nao ficou registrado)');
      }
      linhas.push('');
      linhas.push('**Lacuna identificada:** _(preencher)_');
      linhas.push('');
      linhas.push('**Onde corrigir:** `.cursor/skills/quiver-tap-bugfix/SKILL.md` (o agente nao sabia a regra) ');
      linhas.push('ou `support-agent/src/enrich.ts` (o dossie nao tinha a informacao) ');
      linhas.push('ou nenhum dos dois (problema de arquitetura, nao delegavel).');
      linhas.push('');
    }
  } else if (autos.length) {
    linhas.push('## Rejeitados');
    linhas.push('');
    linhas.push('Nenhum PR automatico foi rejeitado nesta janela.');
    linhas.push('');
  }

  if (!autos.length) {
    linhas.push('Nenhum PR automatico na janela. Se o fixer esta ligado, verifique');
    linhas.push('`npm run agent:fixer:status` e `npm run agent:report`.');
    linhas.push('');
  }

  const conteudo = linhas.join('\n');
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const destino = path.join(REPORT_DIR, `revisao-${hoje}.md`);
  fs.writeFileSync(destino, conteudo, 'utf8');

  console.log(conteudo);
  console.log(`Relatorio salvo em ${destino}`);
  if (rejeitados.length) {
    console.log('');
    console.log('Preencha a lacuna de cada rejeicao antes de fechar a semana.');
    console.log('Rejeicao sem diagnostico anotado nao ensina nada ao agente.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
