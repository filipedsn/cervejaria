import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const logFile = join(mkdtempSync(join(tmpdir(), 'ops-panel-')), 'audit.log');
process.env.OPS_PANEL_AUDIT_LOG = logFile;
const { ACTIONS, ActionError, executeAction, readAudit } = await import('./actions.mjs');

test('lista fechada de ações', () => {
  assert.deepEqual(Object.keys(ACTIONS).sort(), [
    'deploy.approve', 'deploy.dispatch', 'deploy.reject', 'dev.restart', 'dev.start', 'dev.stop', 'pr.merge',
  ]);
});

test('ação desconhecida é recusada', async () => {
  await assert.rejects(executeAction('vps.shell', {}), ActionError);
});

test('parâmetros inválidos são recusados antes de qualquer comando', async () => {
  await assert.rejects(executeAction('pr.merge', { number: 'abc' }), /PR inválido/);
  await assert.rejects(executeAction('deploy.approve', { runId: -1 }), /runId inválido/);
  await assert.rejects(executeAction('deploy.dispatch', { sha: 'main; rm -rf /' }), /Versão inválida/);
});

test('toda tentativa vai para a auditoria, inclusive falhas', () => {
  const lines = readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.length >= 3);
  assert.ok(lines.every((l) => l.ok === false && l.at && l.action));
  assert.equal(readAudit(2).length, 2);
  assert.equal(readAudit(2)[0].action, 'deploy.dispatch');
  assert.equal(readAudit(2)[0].label, 'Iniciar a esteira');
});
