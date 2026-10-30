import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CaixaResposta } from '../lib/operacao';
import { useAuth } from '../contexts/AuthContext';
import { useOperacaoContexto } from '../hooks/useOperacaoContexto';
import { Modal } from './Modal';
import { OperacaoTurnoTapsPanel } from './operacao/OperacaoTurnoTapsPanel';
import { IconBeerTap } from './NavIcons';

/** Atalho de montagem de chope no header (ao lado do QR), no lugar do card da lista. */
export function OperacaoMontagemChopeHeaderButton({ pontoVendaId }: { pontoVendaId: string }) {
  const { canPermission } = useAuth();
  const { contexto } = useOperacaoContexto();
  const [aberto, setAberto] = useState(false);
  const enabled = Boolean(pontoVendaId) && contexto.tapsEnabled && canPermission('taps.operate');
  const caixaQuery = useQuery({
    queryKey: ['operacao-caixa', pontoVendaId],
    queryFn: () => api.get<CaixaResposta>(`/api/operacao/caixa?pontoVendaId=${encodeURIComponent(pontoVendaId)}`),
    enabled,
  });
  const caixaAberto = caixaQuery.data?.sessao?.status === 'ABERTO';
  if (!enabled || !caixaAberto) return null;

  return (
    <>
      <button
        type="button"
        className="icon-btn-ghost h-11 w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
        title="Montagem de chope nas Taps"
        aria-label="Montagem de chope nas Taps"
        onClick={() => setAberto(true)}
      >
        <IconBeerTap className="h-6 w-6" />
      </button>
      <Modal open={aberto} onClose={() => setAberto(false)} title="Montagem de chope nas Taps" wide>
        <OperacaoTurnoTapsPanel pontoVendaId={pontoVendaId} />
      </Modal>
    </>
  );
}
