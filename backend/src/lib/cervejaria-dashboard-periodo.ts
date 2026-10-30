export type DashboardPeriodoMes = {
  tipo: 'mes';
  ano: number;
  mes: number;
  inicio: Date;
  fim: Date;
  label: string;
};

export type DashboardPeriodoIntervalo = {
  tipo: 'periodo';
  de: string;
  ate: string;
  inicio: Date;
  fim: Date;
  label: string;
};

export type DashboardPeriodoResolvido = DashboardPeriodoMes | DashboardPeriodoIntervalo;

export type DashboardPeriodoParseResult =
  | { ok: true; periodo: DashboardPeriodoResolvido }
  | { ok: false; error: string };

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MAX_DIAS = 366;

function parseIsoDate(value: string | undefined): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return { y, m, d };
}

function startOfDay(y: number, m: number, d: number) {
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfDay(y: number, m: number, d: number) {
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function formatPt(y: number, m: number, d: number) {
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function parseCervejariaDashboardPeriodo(
  query: { modo?: string; ano?: string; mes?: string; de?: string; ate?: string },
  now: Date = new Date(),
): DashboardPeriodoParseResult {
  const modo = (query.modo ?? 'mes').trim().toLowerCase();

  if (modo === 'periodo') {
    const de = parseIsoDate(query.de);
    const ate = parseIsoDate(query.ate);
    if (!de || !ate) return { ok: false, error: 'Período inválido' };
    const inicio = startOfDay(de.y, de.m, de.d);
    const fim = endOfDay(ate.y, ate.m, ate.d);
    if (inicio.getTime() > fim.getTime()) return { ok: false, error: 'Período inválido' };
    const hojeFim = endOfDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
    if (inicio.getTime() > hojeFim.getTime()) return { ok: false, error: 'Período futuro indisponível' };
    const fimEfetivo = fim.getTime() > hojeFim.getTime() ? hojeFim : fim;
    const dias = Math.floor((fimEfetivo.getTime() - inicio.getTime()) / 86_400_000) + 1;
    if (dias > MAX_DIAS) return { ok: false, error: 'Período inválido' };
    const deStr = `${de.y}-${String(de.m).padStart(2, '0')}-${String(de.d).padStart(2, '0')}`;
    const ateParts = {
      y: fimEfetivo.getFullYear(),
      m: fimEfetivo.getMonth() + 1,
      d: fimEfetivo.getDate(),
    };
    const ateStr = `${ateParts.y}-${String(ateParts.m).padStart(2, '0')}-${String(ateParts.d).padStart(2, '0')}`;
    return {
      ok: true,
      periodo: {
        tipo: 'periodo',
        de: deStr,
        ate: ateStr,
        inicio,
        fim: fimEfetivo,
        label: `${formatPt(de.y, de.m, de.d)} – ${formatPt(ateParts.y, ateParts.m, ateParts.d)}`,
      },
    };
  }

  if (modo !== 'mes') return { ok: false, error: 'Período inválido' };

  const ano = Number.parseInt(query.ano ?? String(now.getFullYear()), 10);
  const mes = Number.parseInt(query.mes ?? String(now.getMonth() + 1), 10);
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
    return { ok: false, error: 'Período inválido' };
  }
  if (ano > now.getFullYear() || (ano === now.getFullYear() && mes > now.getMonth() + 1)) {
    return { ok: false, error: 'Período futuro indisponível' };
  }
  const inicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
  const fim = new Date(ano, mes, 0, 23, 59, 59, 999);
  return {
    ok: true,
    periodo: {
      tipo: 'mes',
      ano,
      mes,
      inicio,
      fim,
      label: `${MESES[mes - 1]} ${ano}`,
    },
  };
}
