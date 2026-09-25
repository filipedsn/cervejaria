import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { inspectArchitecture, root } from './build-runtime-consumers.mjs';

test('checker detects an active legacy runtime regression', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'domain-checker-'));
  mkdirSync(join(fixture, 'backend/src/routes/quiosque'), { recursive: true });
  mkdirSync(join(fixture, 'frontend/src'), { recursive: true });
  mkdirSync(join(fixture, 'backend/prisma'), { recursive: true });
  writeFileSync(join(fixture, 'backend/src/routes/quiosque/index.ts'), "export const quiosqueRoutes = () => '/api/quiosque';\n");
  writeFileSync(join(fixture, 'frontend/src/App.tsx'), "export const path = '/quiosque';\n");
  writeFileSync(join(fixture, 'backend/prisma/schema.prisma'), 'model ConfiguracaoQuiosque { id String @id }\n');
  const report = inspectArchitecture(fixture);
  assert.ok(report.activeRuntimeReferences > 0);
  assert.equal(report.gates.NO_ACTIVE_QUIOSQUE_DOMAIN, false);
  assert.equal(typeof report.gates.ACTIVE_LEGACY_AUTHORITY, 'boolean');
  assert.ok(report.occurrences.some((item) => item.classification === 'PHYSICAL_DB_COMPATIBILITY'));
  assert.ok(report.occurrences.some((item) => item.classification === 'ACTIVE_RUNTIME'));
});

test('physical compatibility occurrences do not become active failures', () => {
  const report = inspectArchitecture(root);
  const excluded = report.occurrences.filter((item) => item.classification !== 'ACTIVE_RUNTIME');
  assert.ok(excluded.length > 0);
  assert.ok(excluded.every((item) => item.gate === 'EXCLUDED'));
});
