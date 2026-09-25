import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceRoots = ['backend/src', 'frontend/src'];
const ignored = new Set(['node_modules', 'dist', 'build', 'artifacts', 'reports']);
const legacyPatterns = [
  ['quiosqueRoutes', /\bquiosqueRoutes\b/], ['/api/quiosque', /\/api\/quiosque/],
  ['/quiosque', /['"`]\/quiosque(?:[/'"`]|\?|\$\{|\)|\s)/],
  ['ProdutoQuiosque', /\bProdutoQuiosque\b|\bprodutoQuiosque\b/],
  ['ConfiguracaoQuiosque', /\bConfiguracaoQuiosque\b|\bconfiguracaoQuiosque\b/],
  ['CardapioQuiosque', /\bCardapioQuiosque\b|\bcardapioQuiosque\b/],
  ['PedidoQuiosque', /\bPedidoQuiosque\b|\bpedidoQuiosque\b/],
  ['SessaoCaixaQuiosque', /\bSessaoCaixaQuiosque\b|\bsessaoCaixaQuiosque\b/],
  ['EstoqueSaldoQuiosque', /\bEstoqueSaldoQuiosque\b|\bestoqueSaldoQuiosque\b/],
  ['MovimentoEstoqueQuiosque', /\bMovimentoEstoqueQuiosque\b|\bmovimentoEstoqueQuiosque\b/],
  ['produtoQuiosqueId', /\bprodutoQuiosqueId\b/], ['PontoVenda.usaCaixa', /\busaCaixa\b/],
  ['directSalesEnabled', /\bdirectSalesEnabled\b/],
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return ignored.has(entry.name) ? [] : walk(file);
    return file;
  });
}

function classification(file, content) {
  const normalized = file.replaceAll('\\', '/');
  if (/(^|\/)__tests__\//.test(normalized) || /\.(test|spec)\.(?:ts|tsx|mjs|js)$/.test(normalized)) return 'TEST_ONLY';
  if (/\.md$|documentation|docs\//i.test(normalized)) return 'DOCUMENTATION';
  if (normalized.endsWith('schema.prisma') || normalized.includes('/prisma/migrations/')) return 'PHYSICAL_DB_COMPATIBILITY';
  if (/migration|historical|legacy-only/i.test(content) && !normalized.includes('/src/')) return 'HISTORICAL_MIGRATION';
  if (/backend\/src\/(routes|lib)\/quiosque(?:\/|$)/.test(normalized) || /frontend\/src\/pages\/quiosque(?:\/|$)/.test(normalized)) return 'ACTIVE_RUNTIME';
  if (/frontend\/src\//.test(normalized) && /\/quiosque(?:[/'"`]|\?|\$\{|\)|\s)/.test(content)) return 'ACTIVE_RUNTIME';
  if (/backend\/src\//.test(normalized) && /\b(?:quiosqueRoutes|directSalesEnabled|usaCaixa)\b/.test(content)) return 'ACTIVE_RUNTIME';
  return 'ACTIVE_RUNTIME';
}

export function inspectArchitecture(repoRoot = root) {
  const files = [...sourceRoots.flatMap((folder) => walk(join(repoRoot, folder))), join(repoRoot, 'backend/prisma/schema.prisma')]
    .filter((file) => /\.(?:ts|tsx|mjs|js|prisma)$/.test(file));
  const occurrences = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const kind = classification(file, content);
    for (const [legacyDependency, pattern] of legacyPatterns) {
      content.split(/\r?\n/).forEach((line, index) => {
        if (!pattern.test(line)) return;
        occurrences.push({ file: relative(repoRoot, file).replaceAll('\\', '/'), line: index + 1, legacyDependency, classification: kind, gate: kind === 'ACTIVE_RUNTIME' ? 'FAIL' : 'EXCLUDED', evidence: line.trim().slice(0, 240) });
      });
    }
  }
  const active = occurrences.filter((item) => item.classification === 'ACTIVE_RUNTIME');
  const authorities = active.filter((item) => ['PontoVenda.usaCaixa', 'directSalesEnabled', 'ConfiguracaoQuiosque', 'PedidoQuiosque', 'SessaoCaixaQuiosque'].includes(item.legacyDependency));
  return {
    generatedAt: new Date().toISOString(), inspectedRoots: [...sourceRoots, 'backend/prisma/schema.prisma'],
    activeRuntimeReferences: active.length, activeLegacyAuthority: authorities.length,
    gates: {
      PRODUCT_SINGLE_SOURCE: active.every((item) => !['ProdutoQuiosque', 'CardapioQuiosque', 'produtoQuiosqueId'].includes(item.legacyDependency)),
      INVENTORY_SINGLE_ENGINE: active.every((item) => !['EstoqueSaldoQuiosque', 'MovimentoEstoqueQuiosque'].includes(item.legacyDependency)),
      KITCHEN_SINGLE_ENGINE: active.every((item) => !['PedidoQuiosque', 'quiosqueRoutes', '/api/quiosque'].includes(item.legacyDependency)),
      NO_ACTIVE_QUIOSQUE_DOMAIN: active.length === 0, ACTIVE_LEGACY_AUTHORITY: authorities.length === 0,
    }, occurrences,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const report = inspectArchitecture();
  const output = join(root, 'artifacts', 'domain-convergence', 'runtime-consumers.json');
  mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: relative(root, output).replaceAll('\\', '/'), activeRuntimeReferences: report.activeRuntimeReferences, activeLegacyAuthority: report.activeLegacyAuthority, gate: report.gates.NO_ACTIVE_QUIOSQUE_DOMAIN ? 'PASS' : 'FAIL' }));
  process.exitCode = report.gates.NO_ACTIVE_QUIOSQUE_DOMAIN ? 0 : 1;
}
