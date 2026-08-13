/**
 * Roda o fixer manualmente contra Issues especificas, sem esperar o watcher.
 *
 *   npm run fixer --prefix support-agent -- 42 43
 *   npm run fixer --prefix support-agent          (todas as Issues auto-triagem abertas)
 *
 * Util para testar a Fase 3 de forma controlada antes de ligar o loop automatico.
 */
import { config } from './config.js';
import { runFixerForIssues } from './fixer.js';
import { listTriagedIssues } from './github.js';
import { log } from './logger.js';

async function main(): Promise<void> {
  if (!config.fixerEnabled) {
    log.error(
      'Fixer desligado. Defina SUPPORT_AGENT_FIXER_ENABLED=true em support-agent/.env ' +
        'para permitir correcao automatica.',
    );
    process.exit(1);
  }

  const requested = process.argv
    .slice(2)
    .map((arg) => Number.parseInt(arg, 10))
    .filter((n) => Number.isFinite(n));

  let targets = requested;
  if (!targets.length) {
    const issues = await listTriagedIssues();
    targets = issues.map((i) => i.number);
    log.info(`Nenhuma Issue informada; usando as ${targets.length} abertas com label auto-triagem`);
  }

  if (!targets.length) {
    log.info('Nada para corrigir.');
    return;
  }

  await runFixerForIssues(targets);
}

main().catch((err) => {
  log.error('Fixer abortou', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
