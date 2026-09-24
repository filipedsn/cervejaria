import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
// This gate measures executable consumers of the split product/inventory
// domains. Public route names (/api/quiosque), UI labels, compatibility type
// names, tests, migrations and evidence are not runtime dependencies.
const roots = ['backend/src', 'frontend/src', 'ops-panel'];
const ignored = new Set(['node_modules', 'dist', 'artifacts', 'reports']);
const rules = [
  ['LegacyProductModel', /(?:\b(?:prisma|tx)\.produtoQuiosque\b|produtoQuiosqueId|\bprodutoQuiosque\s*:)/],
  ['LegacyInventoryModel', /(?:\b(?:prisma|tx)\.(?:estoqueSaldoQuiosque|movimentoEstoqueQuiosque)\b)/],
];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ignored.has(entry.name) ? [] : files(path);
    return /\.(?:ts|tsx|mjs|js|ps1)$/.test(entry.name) ? [path] : [];
  });
}

const consumers = [];
for (const folder of roots) for (const file of files(join(root, folder))) {
  if (/\.test\.(?:ts|tsx)$/.test(file) || /[\\/]__tests__[\\/]/.test(file)) continue;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => rules.forEach(([legacyDependency, pattern]) => {
    if (pattern.test(line)) consumers.push({
      file: relative(root, file).replaceAll('\\', '/'),
      symbol: `line:${index + 1}`,
      legacyDependency,
      replacement: 'CANONICAL_CUTOVER_PENDING',
      status: 'PENDING',
    });
  }));
}

const output = join(root, 'artifacts', 'domain-convergence', 'runtime-consumers.json');
mkdirSync(resolve(output, '..'), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  activeRuntimeReferences: consumers.length,
  gate: consumers.length === 0 ? 'PASS' : 'PENDING',
  consumers,
}, null, 2)}\n`);
console.log(`${consumers.length} runtime consumer occurrences written to ${relative(root, output)}`);
