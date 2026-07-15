export const BRAZIL_TZ = 'America/Sao_Paulo';

export function getZonedParts(date: Date, timeZone = BRAZIL_TZ) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
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
    second: get('second'),
  };
}

/** Converte data/hora civil em timeZone para instante UTC. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = BRAZIL_TZ,
): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  for (let i = 0; i < 4; i++) {
    const p = getZonedParts(guess, timeZone);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    guess = new Date(guess.getTime() + (desired - actual));
  }

  return guess;
}

export function parseEventDateParts(baseDate: Date) {
  return {
    year: baseDate.getUTCFullYear(),
    month: baseDate.getUTCMonth() + 1,
    day: baseDate.getUTCDate(),
  };
}

export function parseTimeOnEventDate(
  baseDate: Date,
  time: string,
  timeZone = BRAZIL_TZ,
): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const { year, month, day } = parseEventDateParts(baseDate);
  return zonedTimeToUtc(year, month, day, hours, minutes, timeZone);
}

export function floorTo15MinUtc(date: Date, timeZone = BRAZIL_TZ): Date {
  const p = getZonedParts(date, timeZone);
  const flooredMinute = Math.floor(p.minute / 15) * 15;
  return zonedTimeToUtc(p.year, p.month, p.day, p.hour, flooredMinute, timeZone);
}

export function formatIntervalLabel(date: Date, timeZone = BRAZIL_TZ): string {
  const p = getZonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
