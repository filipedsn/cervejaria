import type { Evento, AgendamentoExclusao } from '../types';
import { todayString } from '../components/EventoFormFields';

export function dateKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatAgendaHeading(dateKey: string): string {
  const label = new Date(`${dateKey}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatAgendaDateShort(dateKey: string): string {
  const label = new Date(`${dateKey}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function buildSerieExclusoesMap(exclusoes: AgendamentoExclusao[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const e of exclusoes) {
    const dateKey = e.data.slice(0, 10);
    if (!map.has(e.serieId)) map.set(e.serieId, new Set());
    map.get(e.serieId)!.add(dateKey);
  }
  return map;
}

function isSerieExcludedOnDate(
  exclusoes: ReadonlyMap<string, ReadonlySet<string>>,
  serieId: string,
  dateKey: string,
): boolean {
  return exclusoes.get(serieId)?.has(dateKey) ?? false;
}

export function eventDateStr(evento: Evento): string | null {
  return evento.data?.slice(0, 10) ?? null;
}

export function findOpenSessaoOnDate(sessoes: Evento[], dateKey: string): Evento | null {
  return findOpenSessoesOnDate(sessoes, dateKey)[0] ?? null;
}

export function findOpenSessoesOnDate(sessoes: Evento[], dateKey: string): Evento[] {
  return sessoes
    .filter((s) => s.status === 'ABERTO' && eventDateStr(s) === dateKey)
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
}

export function compareByHorario(a: Evento, b: Evento): number {
  return a.horaInicio.localeCompare(b.horaInicio);
}

export type AgendaItem =
  | { kind: 'serie'; serie: Evento; dateKey: string }
  | { kind: 'sessao'; sessao: Evento };

export type AgendaDay = {
  dateKey: string;
  label: string;
  isToday: boolean;
  isPast: boolean;
  items: AgendaItem[];
};

function dayOfWeekFromKey(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00`).getDay();
}

function hasSessaoForSerieOnDate(sessoes: Evento[], serieId: string, dateKey: string): boolean {
  return sessoes.some((s) => s.serieId === serieId && eventDateStr(s) === dateKey);
}

function collectDateKeys(series: Evento[], sessoes: Evento[], futureWindowDays: number): Set<string> {
  const keys = new Set<string>();
  const todayStr = todayString();
  keys.add(todayStr);

  for (const s of sessoes) {
    const d = eventDateStr(s);
    if (d) keys.add(d);
  }

  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  for (let i = 0; i <= futureWindowDays; i++) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() + i);
    const key = dateKeyFromDate(d);
    const dow = d.getDay();
    if (series.some((serie) => serie.diaSemana === dow)) {
      keys.add(key);
    }
  }

  return keys;
}

function sortDateKeys(keys: string[], todayStr: string): string[] {
  const past = keys.filter((k) => k < todayStr).sort((a, b) => b.localeCompare(a));
  const today = keys.includes(todayStr) ? [todayStr] : [];
  const future = keys.filter((k) => k > todayStr).sort((a, b) => a.localeCompare(b));
  return [...today, ...future, ...past];
}

function itemHorario(item: AgendaItem): string {
  return item.kind === 'serie' ? item.serie.horaInicio : item.sessao.horaInicio;
}

function buildAgendaDayForKey(
  dateKey: string,
  series: Evento[],
  sessoes: Evento[],
  excludedSessaoIds: ReadonlySet<string>,
  serieExclusoes: ReadonlyMap<string, ReadonlySet<string>>,
  todayStr: string,
): AgendaDay {
  const isToday = dateKey === todayStr;
  const isPast = dateKey < todayStr;
  const dow = dayOfWeekFromKey(dateKey);
  const items: AgendaItem[] = [];

  if (!isPast) {
    for (const serie of series.filter((s) => s.diaSemana === dow)) {
      if (isSerieExcludedOnDate(serieExclusoes, serie.id, dateKey)) continue;
      if (!hasSessaoForSerieOnDate(sessoes, serie.id, dateKey)) {
        items.push({ kind: 'serie', serie, dateKey });
      }
    }
  }

  for (const sessao of sessoes) {
    if (eventDateStr(sessao) !== dateKey) continue;
    if (excludedSessaoIds.has(sessao.id)) continue;
    items.push({ kind: 'sessao', sessao });
  }

  items.sort((a, b) => itemHorario(a).localeCompare(itemHorario(b)));

  return {
    dateKey,
    label: formatAgendaHeading(dateKey),
    isToday,
    isPast,
    items,
  };
}

export function getAgendaDayForDate(
  dateKey: string,
  series: Evento[],
  sessoes: Evento[],
  excludedSessaoIds: string[] = [],
  agendamentoExclusoes: AgendamentoExclusao[] = [],
): AgendaDay {
  return buildAgendaDayForKey(
    dateKey,
    series,
    sessoes,
    new Set(excludedSessaoIds),
    buildSerieExclusoesMap(agendamentoExclusoes),
    todayString(),
  );
}

export function buildAgendaDays(
  series: Evento[],
  sessoes: Evento[],
  excludedSessaoIds: string[] = [],
  futureWindowDays = 21,
  agendamentoExclusoes: AgendamentoExclusao[] = [],
): AgendaDay[] {
  const todayStr = todayString();
  const excluded = new Set(excludedSessaoIds);
  const serieExclusoes = buildSerieExclusoesMap(agendamentoExclusoes);
  const dateKeys = sortDateKeys([...collectDateKeys(series, sessoes, futureWindowDays)], todayStr);

  const days: AgendaDay[] = [];

  for (const dateKey of dateKeys) {
    const day = buildAgendaDayForKey(dateKey, series, sessoes, excluded, serieExclusoes, todayStr);
    const hasHiddenOnDay = sessoes.some(
      (s) => excluded.has(s.id) && eventDateStr(s) === dateKey,
    );
    if (day.items.length === 0 && !hasHiddenOnDay) continue;
    days.push(day);
  }

  return days;
}

export function isAgendaEmpty(series: Evento[], sessoes: Evento[]): boolean {
  return series.length === 0 && sessoes.length === 0;
}
