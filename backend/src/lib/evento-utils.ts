export const DIAS_SEMANA = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

export const DIAS_SEMANA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export function isSerie(evento: { recorrencia: string; serieId: string | null }) {
  return evento.recorrencia === 'SEMANAL' && !evento.serieId;
}

export function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayWeekday(): number {
  return new Date().getDay();
}

export const REABRIR_JANELA_MS = 30 * 60 * 1000;

export const REABRIR_PRAZO_EXPIRADO_MSG =
  'O prazo para reabrir este evento expirou (30 minutos após o encerramento).';

export function reabrirPrazoExpirado(encerradoEm: Date | null | undefined, now = Date.now()): boolean {
  if (!encerradoEm) return false;
  return now - encerradoEm.getTime() > REABRIR_JANELA_MS;
}

/** Comandas canceladas não bloqueiam exclusão do evento. */
export const comandaImpedeExclusaoWhere = {
  status: { not: 'CANCELADA' as const },
};
