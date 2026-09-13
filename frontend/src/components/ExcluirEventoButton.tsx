import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { EventoDashboard } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { leaveEvento } from '../lib/socket';
import { Modal } from './Modal';

interface ExcluirEventoButtonProps {
  eventoId: string;
  eventoNome?: string;
  eventoAberto?: boolean;
  className?: string;
  compact?: boolean;
  /** Para onde ir após excluir; `false` permanece na página */
  navigateAfterDelete?: string | false;
}

export function ExcluirEventoButton({
  eventoId,
  eventoNome,
  eventoAberto = false,
  className,
  compact = false,
  navigateAfterDelete = '/eventos',
}: ExcluirEventoButtonProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { evento, setEvento, refreshEvento } = useEvento();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const { data: dashboard, isSuccess: dashboardReady } = useQuery({
    queryKey: ['dashboard', eventoId],
    queryFn: () => api.get<EventoDashboard>(`/api/eventos/${eventoId}/dashboard`),
    enabled: eventoAberto,
    refetchOnWindowFocus: true,
  });

  const totalComandas =
    dashboard?.resumo.comandasAbertas != null && dashboard?.resumo.comandasFechadas != null
      ? dashboard.resumo.comandasAbertas + dashboard.resumo.comandasFechadas
      : null;

  const blockedByComandas = eventoAberto && dashboardReady && (totalComandas ?? 0) > 0;

  const excluirMutation = useMutation({
    mutationFn: () => api.delete(`/api/eventos/${eventoId}`),
    onSuccess: () => {
      setShowConfirmModal(false);
      if (evento?.id === eventoId) {
        leaveEvento(eventoId);
        setEvento(null);
      }
      void refreshEvento();
      queryClient.invalidateQueries({ queryKey: ['eventos'] });
      queryClient.removeQueries({ queryKey: ['dashboard', eventoId] });
      if (navigateAfterDelete !== false) {
        navigate(navigateAfterDelete);
      }
    },
    onError: (err) => {
      setShowConfirmModal(false);
      setErrorMessage(err instanceof ApiError ? err.message : 'Erro ao excluir evento');
    },
  });

  const handleClick = () => {
    if (excluirMutation.isPending || blockedByComandas) return;
    if (eventoAberto && !dashboardReady) return;
    setShowConfirmModal(true);
  };

  const btnClass = compact
    ? 'touch-btn-danger touch-btn-sm px-4'
    : 'touch-btn-danger w-full min-h-12 text-base';

  return (
    <>
      <button
        type="button"
        className={`${btnClass} ${className ?? ''}`}
        disabled={excluirMutation.isPending || blockedByComandas || (eventoAberto && !dashboardReady)}
        onClick={handleClick}
      >
        {excluirMutation.isPending ? 'Excluindo...' : 'Excluir evento'}
      </button>

      <Modal
        open={showConfirmModal}
        onClose={() => !excluirMutation.isPending && setShowConfirmModal(false)}
        title="Excluir evento?"
        footer={
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="touch-btn-orange w-full min-h-14"
              disabled={excluirMutation.isPending}
              onClick={() => setShowConfirmModal(false)}
            >
              Voltar
            </button>
            <button
              type="button"
              className="touch-btn-danger w-full min-h-14"
              disabled={excluirMutation.isPending}
              onClick={() => excluirMutation.mutate()}
            >
              {excluirMutation.isPending ? 'Excluindo...' : 'Excluir evento'}
            </button>
          </div>
        }
      >
        <p className="text-ink-soft leading-relaxed">
          {eventoNome
            ? `O evento "${eventoNome}" será removido permanentemente da agenda.`
            : 'Este evento será removido permanentemente da agenda.'}{' '}
          Esta ação não pode ser desfeita.
        </p>
      </Modal>

      <Modal
        open={!!errorMessage}
        onClose={() => setErrorMessage('')}
        title="Não foi possível excluir"
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

export function canExcluirEvento(evento: { _count?: { comandas?: number } }) {
  return (evento._count?.comandas ?? 0) === 0;
}
