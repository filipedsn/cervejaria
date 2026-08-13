import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, test } from 'node:test';

import { config } from './config.js';
import {
  KILL_SWITCH_FILE,
  engageKillSwitch,
  fixerGate,
  killSwitchActive,
  releaseKillSwitch,
} from './killswitch.js';

/**
 * O teste mexe no arquivo real de kill switch. Se ele existia antes, e restaurado —
 * seria inaceitavel um `npm test` religar o fixer que alguem desligou de proposito.
 */
const preexistente = fs.existsSync(KILL_SWITCH_FILE)
  ? fs.readFileSync(KILL_SWITCH_FILE, 'utf8')
  : null;

afterEach(() => {
  if (preexistente == null) releaseKillSwitch();
  else fs.writeFileSync(KILL_SWITCH_FILE, preexistente, 'utf8');
});

test('engage e release ligam e desligam o switch', () => {
  engageKillSwitch('deploy quebrado');
  const ativo = killSwitchActive();
  assert.equal(ativo.active, true);
  assert.match(ativo.reason, /deploy quebrado/);

  assert.equal(releaseKillSwitch(), true);
  assert.equal(killSwitchActive().active, false);
  assert.equal(releaseKillSwitch(), false, 'release idempotente');
});

test('motivo vazio ainda registra algo legivel', () => {
  engageKillSwitch('   ');
  assert.match(killSwitchActive().reason, /desligado manualmente/);
});

test('kill switch vence o modo completo', () => {
  engageKillSwitch('incidente');
  const gate = fixerGate(false);
  assert.equal(gate.enabled, false);
  assert.equal(gate.enabled === false && gate.source, 'kill-switch');
});

test('modo sombra desliga o fixer mesmo sem kill switch', () => {
  releaseKillSwitch();
  const gate = fixerGate(true);
  assert.equal(gate.enabled, false);
  assert.equal(gate.enabled === false && gate.source, 'modo-sombra');
});

test('sem sombra e sem kill switch, quem decide e a config', () => {
  releaseKillSwitch();
  const gate = fixerGate(false);
  if (config.fixerEnabled) {
    assert.equal(gate.enabled, true);
  } else {
    assert.equal(gate.enabled === false && gate.source, 'config');
  }
});
