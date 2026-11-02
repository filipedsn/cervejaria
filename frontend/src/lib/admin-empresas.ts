const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;

/** Caixa aberto há mais de um dia costuma ser fechamento esquecido. */
export const CAIXA_ABERTO_ALERTA_MS = DIA_MS;

export function tempoAbertoMs(abertoEm: string, agora: number): number {
  return Math.max(0, agora - new Date(abertoEm).getTime());
}

export function formatTempoAberto(ms: number): string {
  if (ms < HORA_MS) return `${Math.floor(ms / MINUTO_MS)} min`;
  if (ms < DIA_MS) {
    const horas = Math.floor(ms / HORA_MS);
    const minutos = Math.floor((ms % HORA_MS) / MINUTO_MS);
    return minutos > 0 ? `${horas} h ${minutos} min` : `${horas} h`;
  }
  const dias = Math.floor(ms / DIA_MS);
  const horas = Math.floor((ms % DIA_MS) / HORA_MS);
  return horas > 0 ? `${dias} d ${horas} h` : `${dias} d`;
}

export function formatDataCivil(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

export function descreverVencimento(proximo: { data: string; diasRestantes: number } | null): string | null {
  if (!proximo) return null;
  const data = formatDataCivil(proximo.data).slice(0, 5);
  if (proximo.diasRestantes === 0) return `Vence hoje (${data})`;
  if (proximo.diasRestantes === 1) return `Vence amanhã (${data})`;
  return `Vence em ${proximo.diasRestantes} dias (${data})`;
}
