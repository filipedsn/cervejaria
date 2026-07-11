export const REABRIR_JANELA_MS = 30 * 60 * 1000;

export function reabrirPrazoExpirado(encerradoEm: string | null | undefined, now = Date.now()): boolean {
  if (!encerradoEm) return false;
  return now - new Date(encerradoEm).getTime() > REABRIR_JANELA_MS;
}

export function podeReabrirEvento(evento: {
  status: string;
  encerradoEm?: string | null;
}): boolean {
  if (evento.status !== 'FECHADO') return false;
  return !reabrirPrazoExpirado(evento.encerradoEm);
}
