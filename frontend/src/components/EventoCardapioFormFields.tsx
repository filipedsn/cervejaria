import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Cardapio, Produto } from '../types';
import { CardapioOperacaoProdutosPicker } from './operacao/CardapioOperacaoProdutosPicker';
import { CardapioSalvoModal, cardapioSalvoLabel } from './CardapioSalvoModal';
export type EventoCardapioModo = 'salvo' | 'montar' | 'depois';

export type EventoCardapioFormState = {
  cardapioModo: EventoCardapioModo;
  cardapioId: string;
  produtoIds: string[];
};

export function defaultEventoCardapioForm(): EventoCardapioFormState {
  return { cardapioModo: 'depois', cardapioId: '', produtoIds: [] };
}

export function EventoCardapioFormFields({
  form,
  setForm,
}: {
  form: EventoCardapioFormState;
  setForm: Dispatch<SetStateAction<EventoCardapioFormState>>;
}) {
  const [modalSalvoAberto, setModalSalvoAberto] = useState(false);

  const { data: cardapios } = useQuery({
    queryKey: ['cardapios', 'ativo'],
    queryFn: () => api.get<Cardapio[]>('/api/cardapios?ativo=true'),
  });

  const { data: catalogo } = useQuery({
    queryKey: ['cardapios', 'catalogo'],
    queryFn: () => api.get<Produto[]>('/api/cardapios/catalogo'),
    enabled: form.cardapioModo === 'montar',
  });

  const toggleProduto = (id: string) => {
    setForm((prev) => ({
      ...prev,
      produtoIds: prev.produtoIds.includes(id)
        ? prev.produtoIds.filter((x) => x !== id)
        : [...prev.produtoIds, id],
    }));
  };

  const resumoSalvo = cardapioSalvoLabel(cardapios, form.cardapioId);

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div>
        <label className="label">Cardápio do evento</label>
        <p className="text-xs text-ink-faint mt-0.5">Comida e outras bebidas (chope fica nas taps).</p>
      </div>

      {form.cardapioModo === 'salvo' && (
        <input
          type="text"
          className="sr-only"
          tabIndex={-1}
          value={form.cardapioId}
          required
          onChange={() => {}}
          aria-hidden
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['salvo', 'Cardápio salvo'],
            ['montar', 'Montar agora'],
            ['depois', 'Definir depois'],
          ] as const
        ).map(([modo, label]) => (
          <button
            key={modo}
            type="button"
            className={`min-h-11 rounded-xl text-xs font-semibold px-2 leading-tight ${
              form.cardapioModo === modo ? 'bg-brand-600 text-white' : 'bg-surface-lighter text-ink-muted'
            }`}
            onClick={() => {
              setForm({ ...form, cardapioModo: modo });
              if (modo === 'salvo') setModalSalvoAberto(true);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {form.cardapioModo === 'salvo' && resumoSalvo && (
        <p className="text-sm text-ink-muted">
          Selecionado: <span className="font-semibold text-ink">{resumoSalvo}</span>
        </p>
      )}

      {form.cardapioModo === 'montar' && catalogo && (
        <CardapioOperacaoProdutosPicker
          catalogo={catalogo}
          selectedIds={form.produtoIds}
          onToggle={toggleProduto}
        />
      )}

      {form.cardapioModo === 'depois' && (
        <p className="text-sm text-ink-muted">
          Você poderá montar o cardápio na tela do evento antes de abrir.
        </p>
      )}

      <CardapioSalvoModal
        open={modalSalvoAberto}
        onClose={() => setModalSalvoAberto(false)}
        value={form.cardapioId}
        onChange={(cardapioId) => setForm({ ...form, cardapioId })}
        cardapios={cardapios}
        emptyMessage="Nenhum cardápio cadastrado. Crie em Configurações → Cardápios."
      />
    </div>
  );
}

export function buildCardapioCreatePayload(form: EventoCardapioFormState) {
  if (form.cardapioModo === 'salvo' && form.cardapioId) {
    return { cardapioId: form.cardapioId };
  }
  if (form.cardapioModo === 'montar' && form.produtoIds.length > 0) {
    return { produtoIds: form.produtoIds };
  }
  return {};
}
