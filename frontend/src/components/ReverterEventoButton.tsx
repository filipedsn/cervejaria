import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { EventoDashboard } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { leaveEvento } from '../lib/socket';
import { Modal } from './Modal';

interface ReverterEventoButtonProps {
  eventoId: string;
  eventoNome?: string;
  /** Sessão de agenda fixa (serieId preenchido) vs evento avulso */
  isSessaoSerie?: boolean;
  className?: string;
  compact?: boolean;
  navigateAfterRevert?: string | false;
}

export function podeReverterEvento(dashboard: EventoDashboard['resumo'] | undefined): boolean {
  if (!dashboard) return false;
  return (
    dashboard.comandasFechadas === 0 &&
    dashboard.vendasAvulsas === 0 &&
    dashboard.valorAberto === 0 &&
    dashboard.receitaAvulsa === 0
  );
}

export function ReverterEventoButton({
  eventoId,
  eventoNome,
  isSessaoSerie = false,
  className,
  compact = false,
  navigateAfterRevert = '/eventos',
}: ReverterEventoButtonProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { evento, setEvento, refreshEvento } = useEvento();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const { data: dashboard, isSuccess: dashboardReady } = useQuery({
    queryKey: ['dashboard', eventoId],
    queryFn: () => api.get<EventoDashboard>(`/api/eventos/${eventoId}/dashboard`),
    refetchOnWindowFocus: true,
  });

  const canRevert = dashboardReady && podeReverterEvento(dashboard?.resumo);

  const label = isSessaoSerie ? 'Voltar para agendado' : 'Desfazer abertura';
  const confirmTitle = isSessaoSerie ? 'Voltar para agendado?' : 'Desfazer abertura?';

  const confirmBody = isSessaoSerie
    ? eventoNome
      ? `"${eventoNome}" deixará de estar ao vivo e o compromisso fixo voltará a aparecer no calendário como agendado.`
      : 'A sessão ao vivo será desfeita e o compromisso fixo voltará a aparecer no calendário como agendado.'
    : eventoNome
      ? `"${eventoNome}" será removido da agenda (sem vendas registradas).`
      : 'O evento será removido da agenda (sem vendas registradas).';

  const reverterMutation = useMutation({
    mutationFn: () =>
      api.post<{ mensagem: string }>(`/api/eventos/${eventoId}/reverter-para-agendado`),
    onSuccess: () => {
      setShowConfirmModal(false);
      if (evento?.id === eventoId) {
        leaveEvento(eventoId);
        setEvento(null);
      }
      void refreshEvento();
      queryClient.invalidateQueries({ queryKey: ['eventos'] });
      queryClient.removeQueries({ queryKey: ['dashboard', eventoId] });
      if (navigateAfterRevert !== false) {
        navigate(navigateAfterRevert);
      }
    },
    onError: (err) => {
      setShowConfirmModal(false);
      setErrorMessage(err instanceof ApiError ? err.message : 'Erro ao reverter evento');
    },
  });

  const handleClick = () => {
    if (reverterMutation.isPending || !canRevert) return;
    setShowConfirmModal(true);
  };

  const btnClass = compact
    ? 'touch-btn-danger touch-btn-sm px-4 w-full'
    : 'touch-btn-danger w-full min-h-12 text-base';

  return (
    <>
      <button
        type="button"
        className={`${btnClass} ${className ?? ''}`}
        disabled={reverterMutation.isPending || !canRevert}
        onClick={handleClick}
      >
        {reverterMutation.isPending ? 'Revertendo...' : label}
      </button>

      <Modal
        open={showConfirmModal}
        onClose={() => !reverterMutation.isPending && setShowConfirmModal(false)}
        title={confirmTitle}
        footer={
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="touch-btn-orange w-full min-h-14"
              disabled={reverterMutation.isPending}
              onClick={() => setShowConfirmModal(false)}
            >
              Voltar
            </button>
            <button
              type="button"
              className="touch-btn-danger w-full min-h-14"
              disabled={reverterMutation.isPending}
              onClick={() => reverterMutation.mutate()}
            >
              {reverterMutation.isPending ? 'Revertendo...' : label}
            </button>
          </div>
        }
      >
        <p className="text-ink-soft leading-relaxed">{confirmBody}</p>
      </Modal>

      <Modal
        open={!!errorMessage}
        onClose={() => setErrorMessage('')}
        title="Não foi possível reverter"
        footer={
          <button
            type="button"
            className="touch-btn-primary w-full min-h-14"
            onClick={() => setErrorMessage('')}
          >
            Entendi
          </button>
        }
      >
        <p className="text-ink-soft leading-relaxed">{errorMessage}</p>
      </Modal>
    </>
  );
}
