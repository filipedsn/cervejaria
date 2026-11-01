import type { DetectorRule, ErrorContext, Severity } from '../watch/types.js';
import { scrubPersonalData, toSafeErrorContext } from './privacy.js';

const EMOJI: Record<Severity, string> = { SEV1: '🚨', SEV2: '⚠️', SEV3: 'ℹ️' };
const brasilia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export function formatBrasilia(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : brasilia.format(date);
}

/** Links for the human: Kibana and the local journey command. Never personal data. */
export type FiringExtras = { context?: ErrorContext; kibanaUrl?: string; environment?: 'dev' | 'prd' };

export function formatFiring(rule: DetectorRule, since: string, detail: string, extras: FiringExtras = {}): string {
  const lines = [
    `[ANALISTA] ${EMOJI[rule.severity]} ${rule.severity} — ${rule.title}`,
    `Detector: ${rule.id}`,
    `Desde: ${formatBrasilia(since)} (Brasília)`,
    `Detalhe: ${scrubPersonalData(detail)}`,
  ];
  const context = extras.context ? toSafeErrorContext(extras.context) : undefined;
  if (context?.routes.length) lines.push(`Rotas mais afetadas: ${context.routes.map((item) => `${item.route} (${item.count})`).join(', ')}`);
  if (context?.correlationIds.length) {
    lines.push(`correlationId: ${context.correlationIds.join(', ')}`);
    lines.push(`Investigar no PC: npm run journey --prefix support-analyst -- --correlacao ${context.correlationIds[0]} --env ${extras.environment ?? 'prd'}`);
  }
  if (extras.kibanaUrl) lines.push(`Kibana: ${extras.kibanaUrl}/app/discover`);
  lines.push(`Próximo passo: ${rule.nextStep}`);
  return lines.join('\n');
}

export function formatReminder(rule: DetectorRule, minutes: number, detail: string): string {
  return [`[ANALISTA] ⏳ AINDA EM ANDAMENTO — ${rule.title} (há ${minutes} min)`, `Detalhe: ${scrubPersonalData(detail)}`].join('\n');
}

export function formatResolved(rule: DetectorRule, minutes: number): string {
  return [`[ANALISTA] ✅ RESOLVIDO — ${rule.title}`, `Duração: ${minutes} min`].join('\n');
}

export function formatInfo(text: string): string {
  return `[ANALISTA] ℹ️ ${scrubPersonalData(text)}`;
}

export function formatChannelTest(now: Date): string {
  return `[ANALISTA] TESTE de canal — ${formatBrasilia(now.toISOString())} (Brasília)`;
}

export type DigestInput = {
  date: string;
  startedAt?: string;
  cycles: number;
  skipped: number;
  firing: string[];
  firings: Record<Severity, number>;
  kibanaAlerts24h?: number;
  releaseSha?: string;
};

export function formatDigest(input: DigestInput): string {
  const [year, month, day] = input.date.split('-');
  return [
    `[ANALISTA] 📋 Resumo diário (prova de vida) — ${day}/${month}/${year}`,
    `Agente rodando desde: ${input.startedAt ? formatBrasilia(input.startedAt) : 'desconhecido'} (Brasília)`,
    `Ciclos desde o último resumo: ${input.cycles} completos, ${input.skipped} pulados (rede do PC fora)`,
    `Detectores agora: ${input.firing.length ? `EM ALERTA: ${input.firing.join('; ')}` : 'todos OK'}`,
    `Alertas disparados desde o último resumo: SEV1 ${input.firings.SEV1} | SEV2 ${input.firings.SEV2} | SEV3 ${input.firings.SEV3}`,
    `Alertas do Kibana nas últimas 24h: ${input.kibanaAlerts24h ?? 'não consultado'}`,
    `Versão no ar: ${input.releaseSha ? input.releaseSha.slice(0, 7) : 'desconhecida'}`,
  ].join('\n');
}
