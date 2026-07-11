import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Evento } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { Modal } from './Modal';

import { podeReabrirEvento } from '../lib/evento-utils';

interface ReabrirEventoButtonProps {
  eventoId: string;
  encerradoEm?: string | null;
  className?: string;
  /** Para onde ir após reabrir; `false` permanece na página */
  navigateAfterReopen?: string | false;
}

export function ReabrirEventoButton({
  eventoId,
  encerradoEm,
  className,
  navigateAfterReopen = '/comandas',
}: ReabrirEventoButtonProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setEvento, refreshEvento } = useEvento();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const reabrirMutation = useMutation({
    mutationFn: () => api.patch<Evento>(`/api/eventos/${eventoId}/reabrir`),
    onSuccess: (updated) => {
      setShowConfirmModal(false);
      setEvento(updated);
      refreshEvento();
      queryClient.invalidateQueries({ queryKey: ['eventos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', eventoId] });
      if (navigateAfterReopen !== false) {
        navigate(navigateAfterReopen);
      }
    },
    onError: (err) => {
      setShowConfirmModal(false);
      setErrorMessage(err instanceof ApiError ? err.message : 'Erro ao reabrir evento');
    },
  });

  if (!podeReabrirEvento({ status: 'FECHADO', encerradoEm })) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className={`touch-btn-primary w-full min-h-12 text-base ${className ?? ''}`}
        disabled={reabrirMutation.isPending}
        onClick={() => setShowConfirmModal(true)}
      >
        {reabrirMutation.isPending ? 'Reabrindo...' : 'Reabrir evento'}
      </button>

      <Modal
        open={showConfirmModal}
        onClose={() => !reabrirMutation.isPending && setShowConfirmModal(false)}
        title="Reabrir evento?"
      >
        <p className="text-ink-soft leading-relaxed">
          O evento voltará ao ar e será possível abrir novas comandas.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          <button
            type="button"
            className="touch-btn-secondary w-full min-h-14"
            disabled={reabrirMutation.isPending}
            onClick={() => setShowConfirmModal(false)}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="touch-btn-primary w-full min-h-14"
            disabled={reabrirMutation.isPending}
            onClick={() => reabrirMutation.mutate()}
          >
            {reabrirMutation.isPending ? 'Reabrindo...' : 'Reabrir evento'}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!errorMessage}
        onClose={() => setErrorMessage('')}
        title="Não foi possível reabrir"
      >
        <p className="text-ink-soft leading-relaxed">{errorMessage}</p>
        <button
          type="button"
          className="touch-btn-primary w-full mt-5 min-h-14"
          onClick={() => setErrorMessage('')}
        >
          Entendi
        </button>
      </Modal>
    </>
  );
}
