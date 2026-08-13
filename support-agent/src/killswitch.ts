import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_ROOT, config } from './config.js';

/**
 * Fase 5 — kill switch do fixer.
 *
 * Sao dois mecanismos, de proposito:
 *
 * - `SUPPORT_AGENT_FIXER_ENABLED=false` decide como o agente sobe.
 * - o arquivo sentinela abaixo desliga o fixer de um agente que **ja esta rodando**,
 *   sem matar o processo e sem parar a triagem. E o que serve numa emergencia: o loop
 *   consulta o arquivo a cada ciclo e antes de cada correcao.
 *
 * A triagem continua: alertas seguem virando Issue, so a correcao automatica para.
 */

export const KILL_SWITCH_FILE = path.join(
  PROJECT_ROOT,
  'deploy',
  'runtime',
  'support-agent-fixer.disabled',
);

export type FixerGate =
  | { enabled: true }
  | { enabled: false; source: 'kill-switch' | 'config' | 'modo-sombra'; reason: string };

export function killSwitchActive(): { active: boolean; reason: string } {
  if (!fs.existsSync(KILL_SWITCH_FILE)) return { active: false, reason: '' };
  let reason = '';
  try {
    reason = fs.readFileSync(KILL_SWITCH_FILE, 'utf8').trim();
  } catch {
    // arquivo ilegivel ainda conta como desligado: na duvida, nao corrige
  }
  return { active: true, reason: reason || 'sem motivo registrado' };
}

export function engageKillSwitch(reason: string): void {
  fs.mkdirSync(path.dirname(KILL_SWITCH_FILE), { recursive: true });
  const stamp = new Date().toISOString();
  fs.writeFileSync(KILL_SWITCH_FILE, `${reason.trim() || 'desligado manualmente'} (${stamp})\n`, 'utf8');
}

export function releaseKillSwitch(): boolean {
  if (!fs.existsSync(KILL_SWITCH_FILE)) return false;
  fs.rmSync(KILL_SWITCH_FILE);
  return true;
}

/** Veredito completo: sombra, config e kill switch, na ordem em que importam. */
export function fixerGate(shadow = config.shadowMode): FixerGate {
  const kill = killSwitchActive();
  if (kill.active) {
    return { enabled: false, source: 'kill-switch', reason: kill.reason };
  }
  if (shadow) {
    return {
      enabled: false,
      source: 'modo-sombra',
      reason: 'SUPPORT_AGENT_SHADOW=true — o agente so abre Issues.',
    };
  }
  if (!config.fixerEnabled) {
    return {
      enabled: false,
      source: 'config',
      reason: 'SUPPORT_AGENT_FIXER_ENABLED=false.',
    };
  }
  return { enabled: true };
}
