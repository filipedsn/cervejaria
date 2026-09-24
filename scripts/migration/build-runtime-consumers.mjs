import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const roots = ['backend/src', 'frontend/src', 'e2e', 'scripts', 'ops-panel'];
const ignored = new Set(['node_modules', 'dist', 'artifacts', 'reports']);
const rules = [
  ['ProdutoQuiosque', /ProdutoQuiosque|produtoQuiosque(?:Id)?/],
  ['ConfiguracaoQuiosque', /ConfiguracaoQuiosque|configuracaoQuiosque/],
  ['PedidoQuiosque', /PedidoQuiosque|pedidoQuiosque/],
  ['LegacyInventory', /EstoqueSaldoQuiosque|MovimentoEstoqueQuiosque/],
  ['QuiosqueApi', /\/api\/quiosque/],
  ['QuiosqueRuntime', /useQuiosqueContexto|\bquiosque\b|\bQuiosque\b/],
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
writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), consumers }, null, 2)}\n`);
console.log(`${consumers.length} runtime consumer occurrences written to ${relative(root, output)}`);
