import type { JourneyCriteria, JourneyMode } from './types.js';

export const JOURNEY_DEFAULT_LIMIT = 500;
export const JOURNEY_MAX_LIMIT = 1000;
export const JOURNEY_MAX_WINDOW_DAYS = 31;

export const JOURNEY_USAGE = `Uso: npm run journey --prefix support-analyst -- (--usuario <id|email|nome> | --sessao <id> | --correlacao <id>) [--desde 24h] [--ate agora] [--env prd|dev] [--resumo] [--limite 500]

  --desde   duração relativa (30m, 24h, 7d) ou data ISO; padrão 24h
  --ate     "agora" (padrão) ou data ISO
  --env     prd (padrão) ou dev; usa deploy/runtime/support-analyst-<env>.env
  --resumo  pede ao LLM local um resumo curto; sem LLM, imprime só a linha do tempo`;

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,200}$/;

export function parseMoment(value: string, now: Date): Date | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'agora' || trimmed === 'now') return new Date(now.getTime());
  const relative = /^(\d{1,4})([mhd])$/.exec(trimmed);
  if (relative) return new Date(now.getTime() - Number(relative[1]) * UNIT_MS[relative[2]!]!);
  const parsed = Date.parse(value.trim());
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

export function parseJourneyArgs(args: string[], now: Date, defaultEnvironment: 'dev' | 'prd' = 'prd'): { ok: true; criteria: JourneyCriteria } | { ok: false; reason: string } {
  const values = new Map<string, string>();
  let summary = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--resumo') { summary = true; continue; }
    if (!['--usuario', '--sessao', '--correlacao', '--desde', '--ate', '--env', '--limite'].includes(arg)) return { ok: false, reason: `argumento desconhecido: ${arg}` };
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) return { ok: false, reason: `${arg} exige um valor` };
    if (values.has(arg)) return { ok: false, reason: `${arg} informado mais de uma vez` };
    values.set(arg, value);
    i += 1;
  }
  const modes = (['usuario', 'sessao', 'correlacao'] as JourneyMode[]).filter((mode) => values.has(`--${mode}`));
  if (modes.length !== 1) return { ok: false, reason: 'informe exatamente um critério: --usuario, --sessao ou --correlacao' };
  const mode = modes[0]!;
  const value = values.get(`--${mode}`)!.trim();
  if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) return { ok: false, reason: 'valor do critério inválido (1 a 200 caracteres, sem caracteres de controle)' };
  if (mode !== 'usuario' && !IDENTIFIER.test(value)) return { ok: false, reason: `--${mode} aceita só letras, números e . _ : -` };
  const environment = (values.get('--env') ?? defaultEnvironment).trim().toLowerCase();
  if (environment !== 'dev' && environment !== 'prd') return { ok: false, reason: '--env deve ser prd ou dev' };
  const from = parseMoment(values.get('--desde') ?? '24h', now);
  const to = parseMoment(values.get('--ate') ?? 'agora', now);
  if (!from || !to) return { ok: false, reason: '--desde/--ate inválidos (use 30m, 24h, 7d, "agora" ou data ISO)' };
  if (from.getTime() >= to.getTime()) return { ok: false, reason: '--desde deve ser anterior a --ate' };
  if (to.getTime() - from.getTime() > JOURNEY_MAX_WINDOW_DAYS * UNIT_MS.d!) return { ok: false, reason: `janela máxima de ${JOURNEY_MAX_WINDOW_DAYS} dias` };
  const limit = Number(values.get('--limite') ?? JOURNEY_DEFAULT_LIMIT);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > JOURNEY_MAX_LIMIT) return { ok: false, reason: `--limite deve ser um inteiro entre 1 e ${JOURNEY_MAX_LIMIT}` };
  return { ok: true, criteria: { mode, value, from, to, environment, summary, limit } };
}
