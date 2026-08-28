import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const serverSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs'),
  'utf8',
);
const smokeRoute = serverSource.match(/app\.get\('\/api\/prod\/smoke',[\s\S]*?\n\}\);/u)?.[0];

test('smoke de producao usa a porta correta e trata sucesso e falha', () => {
  assert.ok(smokeRoute, 'a rota de smoke deve existir');
  assert.doesNotMatch(smokeRoute, /PROD_PORTS/u);
  assert.match(smokeRoute, /PORTS\.prodApi/u);
  assert.match(smokeRoute, /ready: Boolean\(readyRes\?\.ok\)/u);
  assert.match(smokeRoute, /frontend: Boolean\(frontRes\?\.ok\)/u);
  assert.match(smokeRoute, /ok: Boolean\(readyRes\?\.ok && frontRes\?\.ok/u);
  assert.match(smokeRoute, /reply\.code\(500\)\.send\(\{ error:/u);
});
