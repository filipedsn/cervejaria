import type { Dispatch, SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Cardapio, Produto } from '../types';
import { CardapioProdutosPicker } from './CardapioProdutosPicker';

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

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div>
        <label className="label">Cardápio do evento</label>
        <p className="text-xs text-ink-faint mt-0.5">Comida e outras bebidas (chope fica nas taps).</p>
      </div>

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
            onClick={() => setForm({ ...form, cardapioModo: modo })}
          >
            {label}
          </button>
        ))}
      </div>

      {form.cardapioModo === 'salvo' && (
        <div>
          <label className="label">Selecione o cardápio</label>
          <select
            className="input"
            value={form.cardapioId}
            onChange={(e) => setForm({ ...form, cardapioId: e.target.value })}
            required
          >
            <option value="">Escolha um cardápio</option>
            {(cardapios ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} ({c.itemCount ?? c.produtos?.length ?? 0} itens)
              </option>
            ))}
          </select>
          {(cardapios?.length ?? 0) === 0 && (
            <p className="text-xs text-ink-faint mt-1">
              Nenhum cardápio cadastrado. Crie em Configurações → Cardápios.
            </p>
          )}
        </div>
      )}

      {form.cardapioModo === 'montar' && catalogo && (
        <CardapioProdutosPicker
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
