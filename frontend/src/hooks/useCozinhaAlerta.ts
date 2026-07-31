import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ensurePedidoAlertAudioRunning,
  isPedidoAlertAudioLocked,
  playAlertaAgora,
} from '../lib/pedido-alert';
import { useScreenWakeLock } from './useScreenWakeLock';

/**
 * Chave propria: a cozinha e outro aparelho e outra pessoa, entao ligar o som
 * do tablet da cozinha nao deve mexer no alerta do celular do balcao.
 */
const STORAGE_KEY = 'quiver:cozinha-alerta';

/** Sem repetir, um pedido que chegou com a cozinha de costas fica esquecido. */
const REPETICAO_MS = 25_000;

function lerPreferencia(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === '1';
}

/**
 * Som e tela ligada da fila da cozinha. `aguardando` e a quantidade de pedidos
 * ainda nao iniciados: enquanto houver algum, o alerta volta a tocar.
 */
export function useCozinhaAlerta(aguardando: number) {
  const [ativo, setAtivo] = useState(lerPreferencia);
  const [audioBloqueado, setAudioBloqueado] = useState(() => isPedidoAlertAudioLocked());
  const jaAvisados = useRef(new Set<string>());

  // A tela da cozinha fica ociosa entre pedidos e apagaria justo na hora do movimento.
  useScreenWakeLock(ativo);

  useEffect(() => {
    if (!ativo) return;

    // O navegador suspende o audio quando a tela dorme; qualquer toque libera de novo.
    const restaurar = () => {
      void ensurePedidoAlertAudioRunning().then((ok) => setAudioBloqueado(!ok));
    };

    document.addEventListener('visibilitychange', restaurar);
    window.addEventListener('focus', restaurar);
    document.addEventListener('pointerdown', restaurar, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', restaurar);
      window.removeEventListener('focus', restaurar);
      document.removeEventListener('pointerdown', restaurar);
    };
  }, [ativo]);

  useEffect(() => {
    if (!ativo || aguardando <= 0) return;

    const id = window.setInterval(() => void playAlertaAgora(), REPETICAO_MS);
    return () => window.clearInterval(id);
  }, [ativo, aguardando]);

  const alternar = useCallback(async () => {
    if (ativo && !audioBloqueado) {
      localStorage.removeItem(STORAGE_KEY);
      setAtivo(false);
      return;
    }

    localStorage.setItem(STORAGE_KEY, '1');
    setAtivo(true);
    const ok = await playAlertaAgora();
    setAudioBloqueado(!ok);
  }, [ativo, audioBloqueado]);

  /** Toca uma vez por pedido, mesmo que ele chegue pelo socket e pelo refetch. */
  const avisar = useCallback(
    (pedidoId: string) => {
      if (!ativo) return;
      if (jaAvisados.current.has(pedidoId)) return;
      jaAvisados.current.add(pedidoId);
      void playAlertaAgora();
    },
    [ativo],
  );

  /** Marca o que ja estava na fila para a tela nao apitar ao ser aberta. */
  const ignorar = useCallback((pedidoIds: string[]) => {
    for (const id of pedidoIds) jaAvisados.current.add(id);
  }, []);

  return { ativo, precisaLiberar: ativo && audioBloqueado, alternar, avisar, ignorar };
}
