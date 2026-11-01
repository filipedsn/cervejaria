import { useEffect, useRef } from 'react';
import {
  ensurePedidoAlertAudioRunning,
  playAlertaAgora,
} from '../lib/pedido-alert';

const INTERVALO_PADRAO_SEGUNDOS = 10;

export function normalizarIntervaloAlarmeComandas(segundos: number): number {
  if (!Number.isFinite(segundos)) return INTERVALO_PADRAO_SEGUNDOS;
  return Math.min(120, Math.max(5, Math.round(segundos)));
}

/**
 * Enquanto a tela de comandas estiver aberta e houver pendência de Servir ou
 * solicitação de pagamento, repete o alerta no intervalo configurado.
 */
export function useComandasAtendimentoAlarme(params: {
  ativo: boolean;
  intervaloSegundos: number;
  precisaAlarme: boolean;
}) {
  const { ativo, intervaloSegundos, precisaAlarme } = params;
  const tocouImediatamente = useRef(false);

  useEffect(() => {
    if (!ativo || !precisaAlarme) {
      tocouImediatamente.current = false;
      return;
    }

    const ms = normalizarIntervaloAlarmeComandas(intervaloSegundos) * 1000;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tocar = () => {
      void ensurePedidoAlertAudioRunning().then((ok) => {
        if (!ok || cancelled) return;
        void playAlertaAgora();
      });
    };

    if (!tocouImediatamente.current) {
      tocouImediatamente.current = true;
      tocar();
    }

    timer = setInterval(tocar, ms);

    const restaurar = () => {
      void ensurePedidoAlertAudioRunning();
    };
    document.addEventListener('visibilitychange', restaurar);
    window.addEventListener('focus', restaurar);
    document.addEventListener('pointerdown', restaurar, { passive: true });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', restaurar);
      window.removeEventListener('focus', restaurar);
      document.removeEventListener('pointerdown', restaurar);
    };
  }, [ativo, intervaloSegundos, precisaAlarme]);
}
