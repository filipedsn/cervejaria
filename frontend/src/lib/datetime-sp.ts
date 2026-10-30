const BRAZIL_TZ = 'America/Sao_Paulo';

function getZonedParts(date: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRAZIL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 4; i++) {
    const parts = getZonedParts(guess);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = wanted - asUtc;
    if (delta === 0) break;
    guess = new Date(guess.getTime() + delta);
  }
  return guess;
}

/** Valor para input datetime-local no fuso America/Sao_Paulo. */
export function toDatetimeLocalSaoPaulo(date: Date = new Date()): string {
  const p = getZonedParts(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Interpreta datetime-local civil em America/Sao_Paulo como ISO UTC. */
export function datetimeLocalSaoPauloToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('Data/hora inválida');
  const [, y, m, d, h, min] = match;
  return zonedTimeToUtc(Number(y), Number(m), Number(d), Number(h), Number(min)).toISOString();
}

export function formatDateTimeSaoPaulo(value: string | Date): string {
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: BRAZIL_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
