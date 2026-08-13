import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkChangedPaths, checkPath } from './policy.js';

test('permite arquivos de codigo dentro do escopo', () => {
  for (const p of [
    'backend/src/lib/fechar-comanda.ts',
    'backend/src/routes/comandas.ts',
    'frontend/src/pages/Comanda.tsx',
    'backend/qa/lib/quiosque-caixa-tests.ts',
  ]) {
    assert.equal(checkPath(p).allowed, true, p);
  }
});

test('bloqueia denylist mesmo com separador do Windows', () => {
  for (const p of [
    'backend\\.env.production',
    'deploy\\prod-artifacts\\manifest.json',
    'backend/prisma/migrations/20260811120000_usa_cardapio/migration.sql',
    '.cursor/hooks/block-prod-without-approval.mjs',
    '.github/workflows/ci.yml',
    'scripts/prod/deploy.ps1',
    'backend/package-lock.json',
  ]) {
    const verdict = checkPath(p);
    assert.equal(verdict.allowed, false, p);
    assert.equal(verdict.allowed === false && verdict.reason, 'denylist', p);
  }
});

test('bloqueia arquivo fora do allowlist sem estar na denylist', () => {
  const verdict = checkPath('README.md');
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.allowed === false && verdict.reason, 'fora-do-allowlist');
});

test('denylist tem precedencia sobre allowlist', () => {
  // casa com o allowlist de backend/src, mas .env vence
  const verdict = checkPath('backend/src/.env.ts');
  assert.equal(verdict.allowed, false);
});

test('checkChangedPaths acumula apenas as violacoes', () => {
  const violations = checkChangedPaths([
    'backend/src/lib/caixa.ts',
    'deploy/prod-artifacts/manifest.json',
    'frontend/src/App.tsx',
    '.env',
  ]);
  assert.equal(violations.length, 2);
  assert.deepEqual(
    violations.map((v) => v.path),
    ['deploy/prod-artifacts/manifest.json', '.env'],
  );
});
