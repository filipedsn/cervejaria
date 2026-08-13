import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyConfigPatch,
  buildConfigFromEnv,
  controlsFromConfig,
  envBool,
  evaluateAgentHealth,
  fixerEffective,
  formatAgePt,
  parseEnvFile,
  setEnvVar,
} from './support-agent.mjs';

test('parseEnvFile ignora comentarios e aspas', () => {
  const vars = parseEnvFile(`
# comentario
SUPPORT_AGENT_SHADOW=true
SUPPORT_AGENT_DRY_RUN="false"
`);
  assert.equal(vars.SUPPORT_AGENT_SHADOW, 'true');
  assert.equal(vars.SUPPORT_AGENT_DRY_RUN, 'false');
});

test('setEnvVar atualiza chave existente', () => {
  const out = setEnvVar('SUPPORT_AGENT_SHADOW=true\n', 'SUPPORT_AGENT_SHADOW', 'false');
  assert.match(out, /SUPPORT_AGENT_SHADOW=false/);
});

test('setEnvVar adiciona chave ausente', () => {
  const out = setEnvVar('', 'SUPPORT_AGENT_DRY_RUN', 'true');
  assert.match(out, /SUPPORT_AGENT_DRY_RUN=true/);
});

test('fixerEffective respeita sombra e kill switch', () => {
  assert.equal(fixerEffective({ shadow: true, fixerEnabled: true, killSwitchActive: false }).enabled, false);
  assert.equal(fixerEffective({ shadow: false, fixerEnabled: true, killSwitchActive: true }).enabled, false);
  assert.equal(fixerEffective({ shadow: false, fixerEnabled: true, killSwitchActive: false }).enabled, true);
});

test('evaluateAgentHealth penaliza agente parado e dry-run', () => {
  const h = evaluateAgentHealth({
    process: { running: false, pid: null },
    elasticsearch: { ok: true, detail: 'cluster yellow' },
    config: { dryRun: true, shadow: true, pollIntervalMs: 60_000, fixerEnabled: false },
    state: { lastPollIso: new Date(Date.now() - 3_600_000).toISOString() },
    killSwitch: { active: false, reason: '' },
    gh: { ok: true },
  });
  assert.equal(h.level, 'critico');
  assert.ok(h.score < 50);
  assert.ok(h.checks.some((c) => c.id === 'processo'));
  assert.ok(h.checks.some((c) => c.id === 'dry-run'));
});

test('evaluateAgentHealth saudavel com processo e poll recente', () => {
  const h = evaluateAgentHealth({
    process: { running: true, pid: 42 },
    elasticsearch: { ok: true, detail: 'cluster green' },
    config: { dryRun: false, shadow: true, pollIntervalMs: 60_000, fixerEnabled: false },
    state: { lastPollIso: new Date().toISOString() },
    killSwitch: { active: false, reason: '' },
    gh: { ok: true },
  });
  assert.equal(h.level, 'saudavel');
  assert.ok(h.score >= 80);
});

test('controlsFromConfig desabilita fixer em modo sombra', () => {
  const controls = controlsFromConfig(
    buildConfigFromEnv({ SUPPORT_AGENT_SHADOW: 'true', SUPPORT_AGENT_FIXER_ENABLED: 'true' }, { active: false, reason: '' }),
    true,
    { active: false, reason: '' },
  );
  const fixer = controls.find((c) => c.id === 'fixerEnabled');
  assert.equal(fixer.disabled, true);
});

test('applyConfigPatch altera variaveis booleanas', () => {
  const { content, applied } = applyConfigPatch(
    'SUPPORT_AGENT_SHADOW=true\n',
    { shadow: false, dryRun: true },
    'http://127.0.0.1:4318',
  );
  assert.equal(applied.shadow, false);
  assert.equal(applied.dryRun, true);
  assert.match(content, /SUPPORT_AGENT_SHADOW=false/);
  assert.match(content, /SUPPORT_AGENT_DRY_RUN=true/);
});

test('formatAgePt', () => {
  assert.equal(formatAgePt(30_000), '30s');
  assert.equal(formatAgePt(120_000), '2 min');
});

test('envBool', () => {
  assert.equal(envBool('true'), true);
  assert.equal(envBool('0'), false);
  assert.equal(envBool(undefined, true), true);
});
