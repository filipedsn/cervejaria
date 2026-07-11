import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { EventoCardapio } from '../types';
import { IconClipboard } from './NavIcons';
import { Modal } from './Modal';
import { EventoCardapioPanel } from './EventoCardapioPanel';

interface EditarCardapioEventoButtonProps {
  eventoId: string;
  eventoAberto: boolean;
  className?: string;
  iconOnly?: boolean;
}

export function EditarCardapioEventoButton({
  eventoId,
  eventoAberto,
  className = '',
  iconOnly = false,
}: EditarCardapioEventoButtonProps) {
  const [open, setOpen] = useState(false);

  const { data: cardapio } = useQuery({
    queryKey: ['evento-cardapio', eventoId],
    queryFn: () => api.get<EventoCardapio>(`/api/eventos/${eventoId}/cardapio`),
    enabled: !!eventoId,
  });

  const cardapioVazio = (cardapio?.produtos.length ?? 0) === 0;
  const label = eventoAberto && cardapioVazio ? 'Configurar cardápio do evento' : 'Editar cardápio do evento';

  if (iconOnly) {
    return (
      <>
        <button
          type="button"
          title={label}
          aria-label={label}
          onClick={() => setOpen(true)}
          className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white transition hover:bg-white/20 ${className}`}
        >
          <IconClipboard />
        </button>
        <Modal open={open} onClose={() => setOpen(false)} title="Cardápio do evento">
          <EventoCardapioPanel
            eventoId={eventoId}
            eventoAberto={eventoAberto}
            embedded
            onClose={() => setOpen(false)}
          />
        </Modal>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`touch-btn-secondary touch-btn-sm inline-flex items-center justify-center gap-2 ${className}`}
      >
        <IconClipboard className="w-4 h-4" />
        {eventoAberto && cardapioVazio ? 'Configurar cardápio' : 'Editar cardápio'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cardápio do evento">
        <EventoCardapioPanel
          eventoId={eventoId}
          eventoAberto={eventoAberto}
          embedded
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
