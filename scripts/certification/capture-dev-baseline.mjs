import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertTestProdWriteGuard } from '../test-prod-write-guard.mjs';

const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const compareArgument = process.argv.find((argument) => argument.startsWith('--compare='));
if (!outputArgument) throw new Error('Use --output=<baseline.json>.');

assertTestProdWriteGuard({
  environment: process.env,
  requireDevDatabase: true,
  context: 'DEV baseline capture',
});

const query = `
  SELECT json_build_object(
    'database', current_database(),
    'capturedAt', now(),
    'counts', json_build_object(
      'Produto', (SELECT count(*) FROM public."Produto"),
      'Comanda', (SELECT count(*) FROM public."Comanda"),
      'ItemComanda', (SELECT count(*) FROM public."ItemComanda"),
      'Pagamento', (SELECT count(*) FROM public."Pagamento"),
      'Evento', (SELECT count(*) FROM public."Evento"),
      'PedidoOperacao', (SELECT count(*) FROM quiosque."PedidoQuiosque"),
      'InventoryBalance', (SELECT count(*) FROM quiosque."EstoqueSaldoQuiosque"),
      'InventoryMovement', (SELECT count(*) FROM quiosque."MovimentoEstoqueQuiosque"),
      'SessaoCaixaOperacao', (SELECT count(*) FROM quiosque."SessaoCaixaQuiosque"),
      'ConfiguracaoOperacional', (SELECT count(*) FROM public."ConfiguracaoOperacional"),
      'ConfiguracaoOperacao', (SELECT count(*) FROM quiosque."ConfiguracaoQuiosque"),
      'TransacaoLog', (SELECT count(*) FROM public."TransacaoLog")
    ),
    'financial', json_build_object(
      'comandaTotal', (SELECT coalesce(sum(total), 0) FROM public."Comanda"),
      'paymentTotal', (SELECT coalesce(sum(valor), 0) FROM public."Pagamento"),
      'cashMovementTotal', (SELECT coalesce(sum(valor), 0) FROM quiosque."MovimentoCaixaQuiosque")
    )
  );
`;

const stdout = execFileSync(
  'docker',
  ['exec', 'cervejaria-db-dev', 'psql', '-U', 'cervejaria', '-d', 'cervejaria_dev', '-Atc', query],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
).trim();

const baseline = JSON.parse(stdout);
if (baseline.database !== 'cervejaria_dev') throw new Error('Baseline capture refused: target is not cervejaria_dev.');

if (compareArgument) {
  const before = JSON.parse(readFileSync(path.resolve(compareArgument.slice('--compare='.length)), 'utf8'));
  const countDifference = Object.fromEntries(Object.keys(baseline.counts).map((key) => [
    key,
    Number(baseline.counts[key]) - Number(before.counts?.[key] ?? 0),
  ]));
  const financialDifference = Object.fromEntries(Object.keys(baseline.financial).map((key) => [
    key,
    Number(baseline.financial[key]) - Number(before.financial?.[key] ?? 0),
  ]));
  baseline.reconciliation = {
    comparedTo: path.basename(compareArgument.slice('--compare='.length)),
    zeroDataLoss: Object.values(countDifference).every((difference) => difference >= 0),
    countDifference,
    financialDifference,
    financialDifferenceIsZero: Object.values(financialDifference).every((difference) => difference === 0),
  };
}

const output = path.resolve(outputArgument.slice('--output='.length));
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`DEV_BASELINE_CAPTURE=PASS\nOUTPUT=${output}`);
