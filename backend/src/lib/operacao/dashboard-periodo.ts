export type DashboardPeriodo = { ano: number; mes: number };

export type DashboardPeriodoResult =
  | { ok: true; periodo: DashboardPeriodo }
  | { ok: false; error: 'Período inválido' | 'Período futuro indisponível' };

export function parseDashboardPeriodo(query: { ano?: string; mes?: string }, now: Date = new Date()): DashboardPeriodoResult {
  const ano = Number.parseInt(query.ano ?? String(now.getFullYear()), 10);
  const mes = Number.parseInt(query.mes ?? String(now.getMonth() + 1), 10);
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) return { ok: false, error: 'Período inválido' };
  if (ano > now.getFullYear() || (ano === now.getFullYear() && mes > now.getMonth() + 1)) {
    return { ok: false, error: 'Período futuro indisponível' };
  }
  return { ok: true, periodo: { ano, mes } };
}
