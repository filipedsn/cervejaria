import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  type AtendimentoBalcaoEvento,
  getAtendimentoBalcaoPendente,
  isBalcaoAlertaEnabled,
  limparAtendimentoBalcao,
  listAtendimentosBalcaoPendentes,
  registrarAtendimentoBalcao,
  setBalcaoAlertaEnabled,
  subscribeAtendimentoBalcao,
  temAtendimentoBalcaoPendente,
} from '../lib/atendimento-balcao';
import { connectSocket, getSocket } from '../lib/socket';

function snapshot() {
  return {
    pendentes: listAtendimentosBalcaoPendentes(),
    alertaEnabled: isBalcaoAlertaEnabled(),
  };
}

export function useAtendimentoBalcao() {
  const { cervejaria } = useAuth();
  const [state, setState] = useState(snapshot);

  const refresh = useCallback(() => setState(snapshot()), []);

  useEffect(() => subscribeAtendimentoBalcao(refresh), [refresh]);

  useEffect(() => {
    if (!cervejaria?.id) return;
    connectSocket(cervejaria.id);
    const socket = getSocket();
    const onAtendimento = (payload: AtendimentoBalcaoEvento) => {
      registrarAtendimentoBalcao(payload);
    };
    socket.on('operacao:atendimento-pedido', onAtendimento);
    return () => {
      socket.off('operacao:atendimento-pedido', onAtendimento);
    };
  }, [cervejaria?.id]);

  const marcarAtendido = useCallback((comandaId: string) => {
    limparAtendimentoBalcao(comandaId);
  }, []);

  const alternarAlerta = useCallback((enabled: boolean) => {
    setBalcaoAlertaEnabled(enabled);
    refresh();
  }, [refresh]);

  return {
    pendentes: state.pendentes,
    alertaEnabled: state.alertaEnabled,
    temPendente: temAtendimentoBalcaoPendente,
    getPendente: getAtendimentoBalcaoPendente,
    marcarAtendido,
    alternarAlerta,
  };
}
