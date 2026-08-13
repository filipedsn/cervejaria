import type { Dispatch, SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  type CardapioQuiosque,
  type ProdutoQuiosque,
  type TurnoCardapioFormState,
  defaultTurnoCardapioForm,
  buildTurnoCardapioAbrirPayload,
} from '../../lib/quiosque';
import { CardapioQuiosqueProdutosPicker } from './CardapioQuiosqueProdutosPicker';

export { defaultTurnoCardapioForm, buildTurnoCardapioAbrirPayload };
export type { TurnoCardapioFormState };

export function TurnoCardapioFormFields({
  form,
  setForm,
}: {
  form: TurnoCardapioFormState;
  setForm: Dispatch<SetStateAction<TurnoCardapioFormState>>;
}) {
  const { data: cardapios } = useQuery({
    queryKey: ['quiosque-cardapios', 'ativo'],
    queryFn: () => api.get<CardapioQuiosque[]>('/api/quiosque/cardapios?ativo=true'),
  });

  const { data: catalogo } = useQuery({
    queryKey: ['quiosque-cardapios', 'catalogo'],
    queryFn: () => api.get<ProdutoQuiosque[]>('/api/quiosque/cardapios/catalogo'),
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
        <label className="label">Cardápio do turno</label>
        <p className="text-xs text-ink-faint mt-0.5">Itens disponíveis para venda enquanto o caixa estiver aberto.</p>
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
              Nenhum cardápio cadastrado. Crie em Cardápio → Cardápios salvos.
            </p>
          )}
        </div>
      )}

      {form.cardapioModo === 'montar' && catalogo && (
        <CardapioQuiosqueProdutosPicker
          catalogo={catalogo}
          selectedIds={form.produtoIds}
          onToggle={toggleProduto}
        />
      )}

      {form.cardapioModo === 'depois' && (
        <p className="text-sm text-ink-muted">
          Você poderá montar o cardápio com o caixa aberto, ou o catálogo completo será usado automaticamente.
        </p>
      )}
    </div>
  );
}
