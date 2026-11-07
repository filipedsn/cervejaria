import { firstLine, run } from './exec.mjs';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];

/** Mesma allowlist de deploy/tap-quiver/cron-schedules.lib.sh (TAP-178). */
export const SCHEDULE_IDS = Object.freeze([
  'quiver-tap-backup',
  'docker-image-prune',
  'docker-builder-prune',
  'quiver-tap-docker-state',
]);

export const SCHEDULE_ID_RE = /^(quiver-tap-backup|docker-image-prune|docker-builder-prune|quiver-tap-docker-state)$/;
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** BRT = UTC−3 (sem DST). */
export const BRT_UTC_OFFSET = 3;

export function utcHourToBrt(hour) {
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  return (h - BRT_UTC_OFFSET + 24) % 24;
}

export function brtHourToUtc(hour) {
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  return (h + BRT_UTC_OFFSET) % 24;
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

const DOW_BRT = {
  '0': 'domingo',
  '1': 'segunda',
  '2': 'terça',
  '3': 'quarta',
  '4': 'quinta',
  '5': 'sexta',
  '6': 'sábado',
};

export const SCHEDULE_CATALOG = Object.freeze({
  'quiver-tap-backup': {
    label: 'Backup do banco',
    description: 'Dump do Postgres e cópia para o OneDrive.',
    canSetTime: true,
    warnDisable: 'Sem o backup automático, a recuperação depende só de dumps manuais e da cópia já existente no OneDrive.',
  },
  'docker-image-prune': {
    label: 'Limpeza de imagens Docker',
    description: 'Remove imagens sem tag com mais de 24 h.',
    canSetTime: true,
    warnDisable: null,
  },
  'docker-builder-prune': {
    label: 'Limpeza do cache de build',
    description: 'Apaga o cache de build do Docker sem uso (toda quarta).',
    canSetTime: true,
    warnDisable: null,
  },
  'quiver-tap-docker-state': {
    label: 'Estado dos contêineres',
    description: 'Grava o estado dos contêineres a cada minuto para o Elastic.',
    canSetTime: false,
    warnDisable: 'Sem este agendamento, o Elastic deixa de receber o batimento dos contêineres e alguns alertas ficam cegos.',
  },
});

/** Formata horário do cron (UTC no arquivo) em texto BRT para a UI. */
export function scheduleTimeText({ minute, hour, dow }) {
  if (minute === '*' && hour === '*') return 'a cada minuto';
  const m = Number(minute);
  const hUtc = Number(hour);
  if (!Number.isInteger(m) || !Number.isInteger(hUtc)) return 'horário irregular';
  const hBrt = utcHourToBrt(hUtc);
  const clock = `${pad2(hBrt)}:${pad2(m)}`;
  if (dow && dow !== '*') {
    const day = DOW_BRT[String(dow)] ?? `dia ${dow}`;
    return `toda ${day} às ${clock}`;
  }
  return `diário às ${clock}`;
}

async function sshCron(host, args) {
  const result = await run('ssh', [...SSH_OPTIONS, host, ...args], { timeoutMs: 60_000 });
  if (result.code !== 0) {
    throw new Error(firstLine(result.stderr) || firstLine(result.stdout) || `o servidor recusou (código ${result.code})`);
  }
  return result.stdout.trim();
}

/** Liga o schedule no VPS (cron-manage.sh enable). */
export async function enableSchedule({ host, id }) {
  const out = await sshCron(host, ['enable', id]);
  if (!out.includes(`ENABLED ${id}`)) throw new Error(firstLine(out) || 'o servidor não confirmou a ligação');
}

/** Desliga o schedule no VPS (renomeia para .disabled). */
export async function disableSchedule({ host, id }) {
  const out = await sshCron(host, ['disable', id]);
  if (!out.includes(`DISABLED ${id}`)) throw new Error(firstLine(out) || 'o servidor não confirmou o desligamento');
}

/** Altera horário (HH:MM em BRT) no VPS. */
export async function setScheduleTime({ host, id, time }) {
  const out = await sshCron(host, ['set-time', id, time]);
  if (!out.includes(`SET_TIME ${id} ${time}`)) throw new Error(firstLine(out) || 'o servidor não confirmou o novo horário');
}
