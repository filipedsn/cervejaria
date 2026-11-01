import type { JourneyCriteria, JourneyEvent } from './types.js';

const NO_SESSION = '(sem session.id)';
const clock = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const day = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' });

function parse(iso: string): Date | undefined {
  const value = /^\d+(\.\d+)?$/.test(iso) ? Number(iso) : Date.parse(iso);
  return Number.isFinite(value) ? new Date(value) : undefined;
}

export function brtTime(iso: string): string {
  const date = parse(iso);
  return date ? clock.format(date) : iso;
}

function brtDateTime(date: Date): string { return dateTime.format(date); }

function cell(value: string | undefined, width: number): string {
  const text = value ?? '—';
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

export function screenOf(event: JourneyEvent): string | undefined {
  return event.route ?? event.page ?? (event.httpRoute ? `${event.httpMethod ? `${event.httpMethod} ` : ''}${event.httpRoute}` : undefined);
}

export function detailOf(event: JourneyEvent): string | undefined {
  if (event.error) return `erro: ${event.error}`;
  if (event.searchTerm) return `busca: "${event.searchTerm}"`;
  if (event.label) return `"${event.label}"`;
  if (event.vital) return event.vital;
  if (event.route && event.httpRoute) return `${event.httpMethod ? `${event.httpMethod} ` : ''}${event.httpRoute}`;
  return event.description ?? (event.page && event.route ? event.page : undefined);
}

export function statusOf(event: JourneyEvent): string | undefined {
  const parts = [event.status === undefined ? undefined : String(event.status), event.durationMs === undefined ? undefined : `${Math.round(event.durationMs)} ms`].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

export function placeOf(event: JourneyEvent): string | undefined {
  const geo = [event.city, event.region].filter(Boolean).join('/') || event.country;
  const parts = [geo, event.ip].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

export function isErrorEvent(event: JourneyEvent): boolean {
  return Boolean(event.error) || event.action === 'ui.error' || (event.status !== undefined && event.status >= 500);
}

export function formatEventLine(event: JourneyEvent): string {
  return [
    brtTime(event.timestamp).padEnd(9),
    cell(screenOf(event), 28),
    cell(event.action, 24),
    cell(detailOf(event), 36),
    cell(statusOf(event), 14),
    placeOf(event) ?? '—',
  ].join(' ').trimEnd();
}

export type JourneySession = { sessionId: string; events: JourneyEvent[] };

/** Groups by session.id in order of first appearance; events without a session go to their own group. */
export function groupBySession(events: JourneyEvent[]): JourneySession[] {
  const sorted = [...events].sort((a, b) => (parse(a.timestamp)?.getTime() ?? 0) - (parse(b.timestamp)?.getTime() ?? 0));
  const groups = new Map<string, JourneyEvent[]>();
  for (const event of sorted) {
    const key = event.sessionId ?? NO_SESSION;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([sessionId, list]) => ({ sessionId, events: list }));
}

function describeCriterion(criteria: Pick<JourneyCriteria, 'mode' | 'value'>): string {
  return `${criteria.mode}=${criteria.value}`;
}

function people(events: JourneyEvent[]): string[] {
  const seen = new Map<string, string>();
  for (const event of events) {
    if (event.source !== 'audit') continue;
    const key = event.userId ?? event.userEmail ?? event.userName;
    if (!key || seen.has(key)) continue;
    const name = [event.userName, event.userEmail ? `<${event.userEmail}>` : undefined, event.userId ? `(id ${event.userId})` : undefined, event.roles ? `papel ${event.roles}` : undefined, event.tenant ? `cervejaria ${event.tenant}` : undefined].filter(Boolean).join(' ');
    seen.set(key, name);
  }
  return [...seen.values()];
}

export type TimelineInput = { criteria: JourneyCriteria; events: JourneyEvent[]; auditTotal: number; traceCount: number };

/** Plain-text timeline in Brasília time, grouped by session. Local output: may contain personal data. */
export function formatTimeline(input: TimelineInput): string {
  const { criteria, events } = input;
  const lines: string[] = [
    `Jornada (${criteria.environment.toUpperCase()}) — critério ${describeCriterion(criteria)} — ${brtDateTime(criteria.from)} a ${brtDateTime(criteria.to)} (horário de Brasília)`,
  ];
  if (!events.length) {
    lines.push('Nenhum evento encontrado para o critério nesta janela.');
    return `${lines.join('\n')}\n`;
  }
  const auditCount = events.filter((event) => event.source === 'audit').length;
  const sessions = groupBySession(events);
  lines.push(`Eventos: ${events.length} (auditoria ${auditCount}${input.auditTotal > auditCount ? ` de ${input.auditTotal}, truncado em --limite` : ''}, traces ${input.traceCount}) em ${sessions.length} grupo(s) de sessão`);
  const who = people(events);
  if (who.length) lines.push(`Quem: ${who.join('; ')}`);
  lines.push('');
  lines.push(`${'Hora'.padEnd(9)} ${'Tela'.padEnd(28)} ${'Ação'.padEnd(24)} ${'Detalhe'.padEnd(36)} ${'Status/tempo'.padEnd(14)} Cidade/IP`);
  for (const session of sessions) {
    const firstEvent = session.events[0]!;
    const lastEvent = session.events[session.events.length - 1]!;
    const device = [firstEvent.userAgent, firstEvent.os].filter(Boolean).join('/') || session.events.map((event) => [event.userAgent, event.os].filter(Boolean).join('/')).find(Boolean);
    const firstDate = parse(firstEvent.timestamp);
    lines.push('');
    lines.push(`== Sessão ${session.sessionId} — ${firstDate ? day.format(firstDate) : ''} ${brtTime(firstEvent.timestamp)} a ${brtTime(lastEvent.timestamp)} (${session.events.length} eventos)${device ? ` — ${device}` : ''} ==`);
    for (const event of session.events) lines.push(formatEventLine(event));
    const errors = session.events.filter(isErrorEvent);
    lines.push(`   Erros na sessão: ${errors.length}${errors.length ? ` (último ${brtTime(errors[errors.length - 1]!.timestamp)}: ${detailOf(errors[errors.length - 1]!) ?? statusOf(errors[errors.length - 1]!) ?? errors[errors.length - 1]!.action ?? ''})` : ''}`);
    lines.push(`   Último passo: ${brtTime(lastEvent.timestamp)} em ${screenOf(lastEvent) ?? '—'} (${lastEvent.action ?? 'sem ação'})`);
  }
  return `${lines.join('\n')}\n`;
}
