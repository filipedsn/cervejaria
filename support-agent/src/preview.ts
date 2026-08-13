/**
 * Mostra o dossie que seria publicado, sem tocar no GitHub.
 *
 *   npm run preview --prefix support-agent
 *   npm run preview --prefix support-agent -- quiver-tap-5xx-rate-prd
 *
 * E a ferramenta central da Fase 2: e lendo esta saida que se decide se o
 * enriquecimento esta bom o suficiente para embasar uma correcao automatica.
 */
import { enrich } from './enrich.js';
import { issueBody, issueTitle } from './github.js';
import { buildDossier, isActionable } from './triage.js';
import { fetchNewAlerts, isRecovery } from './watcher.js';

async function main(): Promise<void> {
  const ruleFilter = process.argv[2];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();

  const alerts = (await fetchNewAlerts(since))
    .filter((a) => !isRecovery(a))
    .filter((a) => !ruleFilter || a.ruleName === ruleFilter);

  if (!alerts.length) {
    console.log(`Nenhum alerta desde ${since}${ruleFilter ? ` para a regra ${ruleFilter}` : ''}.`);
    return;
  }

  for (const alert of alerts) {
    const evidence = await enrich(alert);
    const dossier = buildDossier(alert, evidence);
    const verdict = isActionable(dossier);

    console.log('\n'.padEnd(2, '\n') + '='.repeat(78));
    console.log(`TITULO      ${issueTitle(dossier)}`);
    console.log(`CLASSE      ${dossier.decision.kind}`);
    console.log(`FINGERPRINT ${dossier.fingerprint}`);
    console.log(`ACIONAVEL   ${verdict.ok ? 'sim' : `nao — ${verdict.reason}`}`);
    console.log('='.repeat(78));
    if (dossier.decision.kind !== 'codigo') {
      console.log('(regra fora do escopo de correcao; corpo omitido)');
      continue;
    }
    console.log(issueBody(dossier));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
