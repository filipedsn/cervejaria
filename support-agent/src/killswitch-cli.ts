import { KILL_SWITCH_FILE, engageKillSwitch, fixerGate, killSwitchActive, releaseKillSwitch } from './killswitch.js';

/**
 * Kill switch pela linha de comando:
 *
 *   npm run agent:fixer:off -- "motivo"
 *   npm run agent:fixer:on
 *   npm run agent:fixer:status
 */

const [action, ...rest] = process.argv.slice(2);

function status(): void {
  const kill = killSwitchActive();
  const gate = fixerGate();
  console.log(`Arquivo      ${KILL_SWITCH_FILE}`);
  console.log(`Kill switch  ${kill.active ? `ATIVO — ${kill.reason}` : 'inativo'}`);
  console.log(`Fixer        ${gate.enabled ? 'habilitado' : `desligado (${gate.source}: ${gate.reason})`}`);
  if (!kill.active) {
    console.log('');
    console.log('A triagem nunca e afetada pelo kill switch: alertas continuam virando Issue.');
  }
}

switch (action) {
  case 'off': {
    engageKillSwitch(rest.join(' '));
    console.log('Kill switch ATIVADO. O fixer para no proximo ciclo; a triagem continua.');
    status();
    break;
  }
  case 'on': {
    const removed = releaseKillSwitch();
    console.log(removed ? 'Kill switch liberado.' : 'Kill switch nao estava ativo.');
    status();
    break;
  }
  case 'status':
  case undefined: {
    status();
    break;
  }
  default: {
    console.error(`Acao desconhecida: ${action}. Use off, on ou status.`);
    process.exit(1);
  }
}
