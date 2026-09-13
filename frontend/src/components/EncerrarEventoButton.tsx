import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Evento, EventoDashboard } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { getSocket } from '../lib/socket';
import { Modal } from './Modal';

interface EncerrarEventoButtonProps {
  eventoId: string;
  className?: string;
  /** Para onde ir após encerrar; `false` permanece na página */
  navigateAfterClose?: string | false;
}

export function EncerrarEventoButton({
  eventoId,
  className,
  navigateAfterClose = '/eventos',
}: EncerrarEventoButtonProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setEvento, refreshEvento } = useEvento();
  const [showComandasAbertasModal, setShowComandasAbertasModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showResumoModal, setShowResumoModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const { data: dashboard, isSuccess } = useQuery({
    queryKey: ['dashboard', eventoId],
    queryFn: () => api.get<EventoDashboard>(`/api/eventos/${eventoId}/dashboard`),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const socket = getSocket();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', eventoId] });
    };

    socket.on('comanda:created', invalidate);
    socket.on('comanda:updated', invalidate);
    socket.on('comanda:closed', invalidate);
    socket.on('item:added', invalidate);
    socket.on('item:removed', invalidate);

    return () => {
      socket.off('comanda:created', invalidate);
      socket.off('comanda:updated', invalidate);
      socket.off('comanda:closed', invalidate);
      socket.off('item:added', invalidate);
      socket.off('item:removed', invalidate);
    };
  }, [eventoId, queryClient]);

  const comandasAbertas = dashboard?.resumo.comandasAbertas;

  const fecharMutation = useMutation({
    mutationFn: () => api.patch<Evento>(`/api/eventos/${eventoId}/fechar`),
    onSuccess: () => {
      setEvento(null);
      refreshEvento();
      queryClient.invalidateQueries({ queryKey: ['eventos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', eventoId] });
      setShowConfirmModal(false);
      setShowResumoModal(true);
    },
    onError: (err) => {
      setShowConfirmModal(false);
      setErrorMessage(err instanceof ApiError ? err.message : 'Erro ao encerrar evento');
    },
  });

  const handleClick = () => {
    if (!isSuccess || fecharMutation.isPending) return;

    if ((comandasAbertas ?? 0) > 0) {
      setShowComandasAbertasModal(true);
      return;
    }

    setShowConfirmModal(true);
  };

  const handleConfirmEncerrar = () => {
    fecharMutation.mutate();
  };

  return (
    <>
      <div className={className ?? ''}>
        <button
          type="button"
          className="touch-btn-orange w-full text-lg min-h-14 disabled:cursor-not-allowed"
          disabled={!isSuccess || fecharMutation.isPending}
          onClick={handleClick}
        >
          {fecharMutation.isPending ? 'Encerrando...' : 'Encerrar evento'}
        </button>
      </div>

      <Modal
        open={showConfirmModal}
        onClose={() => !fecharMutation.isPending && setShowConfirmModal(false)}
        title="Encerrar evento?"
        footer={
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="touch-btn-secondary w-full min-h-14"
              disabled={fecharMutation.isPending}
              onClick={() => setShowConfirmModal(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="touch-btn-orange w-full min-h-14"
              disabled={fecharMutation.isPending}
              onClick={handleConfirmEncerrar}
            >
              {fecharMutation.isPending ? 'Encerrando...' : 'Encerrar evento'}
            </button>
          </div>
        }
      >
        <p className="text-ink-soft leading-relaxed">
          Não será possível abrir novas comandas até iniciar outro evento.
        </p>
      </Modal>

      <Modal
        open={showResumoModal}
        onClose={() => {
          setShowResumoModal(false);
          if (navigateAfterClose !== false) navigate(navigateAfterClose);
        }}
        title="Evento encerrado"
        footer={
          <div className="grid grid-cols-1 gap-3">
            <Link
              to={`/eventos/${eventoId}/resumo`}
              className="touch-btn-primary w-full min-h-14 inline-flex items-center justify-center"
              onClick={() => setShowResumoModal(false)}
            >
              Ver resumo executivo
            </Link>
            <button
              type="button"
              className="touch-btn-secondary w-full min-h-14"
              onClick={() => {
                setShowResumoModal(false);
                if (navigateAfterClose !== false) navigate(navigateAfterClose);
              }}
            >
              {navigateAfterClose === false ? 'Continuar' : 'Ir para eventos'}
            </button>
          </div>
        }
      >
        <p className="text-ink-soft leading-relaxed">
          O evento foi finalizado com sucesso. Confira o resumo executivo com receita, produtos e desempenho da noite.
        </p>
      </Modal>

      <Modal
        open={!!errorMessage}
        onClose={() => setErrorMessage('')}
        title="Não foi possível encerrar"
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

      <Modal
        open={showComandasAbertasModal}
        onClose={() => setShowComandasAbertasModal(false)}
        title="Comandas abertas"
        footer={
          <button
            type="button"
            className="touch-btn-primary w-full min-h-14"
            onClick={() => setShowComandasAbertasModal(false)}
          >
            Entendi
          </button>
        }
      >
        <p className="text-ink-soft leading-relaxed">
          Existem {comandasAbertas} comanda{comandasAbertas !== 1 ? 's' : ''} aberta
          {comandasAbertas !== 1 ? 's' : ''}. Feche todas antes de encerrar o evento.
        </p>
      </Modal>
    </>
  );
}
