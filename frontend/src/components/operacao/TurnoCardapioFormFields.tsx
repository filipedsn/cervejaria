import { useState, type Dispatch, SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  type CardapioOperacao,
  type ProdutoOperacao,
  type TurnoCardapioFormState,
  defaultTurnoCardapioForm,
  buildTurnoCardapioAbrirPayload,
} from '../../lib/operacao';
import { CardapioOperacaoProdutosPicker } from './CardapioOperacaoProdutosPicker';
import { CardapioSalvoModal, cardapioSalvoLabel } from '../CardapioSalvoModal';

export { defaultTurnoCardapioForm, buildTurnoCardapioAbrirPayload };
export type { TurnoCardapioFormState };

export function TurnoCardapioFormFields({
  form,
  setForm,
}: {
  form: TurnoCardapioFormState;
  setForm: Dispatch<SetStateAction<TurnoCardapioFormState>>;
}) {
  const [modalSalvoAberto, setModalSalvoAberto] = useState(false);

  const { data: cardapios } = useQuery({
    queryKey: ['operacao-cardapios', 'ativo'],
    queryFn: () => api.get<CardapioOperacao[]>('/api/operacao/cardapios?ativo=true'),
  });

  const { data: catalogo } = useQuery({
    queryKey: ['operacao-cardapios', 'catalogo'],
    queryFn: () => api.get<ProdutoOperacao[]>('/api/operacao/cardapios/catalogo'),
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
    <div className="grid gap-4 rounded-2xl border border-line bg-surface-lighter/50 p-3 sm:p-4 lg:grid-cols-[minmax(190px,.65fr)_minmax(0,1.7fr)] lg:items-center">
      <div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-500/25 bg-brand-500/10 text-brand-400"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3v7M4.5 3v4a2.5 2.5 0 0 0 5 0V3M7 9v12M16 3c-2 2-3 4-3 7v2h3v9M16 3v9"/></svg></span><span><strong className="block text-sm font-semibold sm:text-base">Cardápio do turno</strong><span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">Itens disponíveis para venda enquanto o caixa estiver aberto.</span></span></div>

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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
            className={`min-h-12 rounded-xl border px-2.5 text-xs font-semibold leading-tight transition sm:min-h-[4.25rem] sm:text-sm ${
              form.cardapioModo === modo ? 'border-brand-400 bg-brand-600 text-white shadow-lg shadow-brand-600/20 ring-1 ring-brand-300/30' : 'border-line bg-surface text-ink-muted hover:border-brand-500/40 hover:text-ink'
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
        <p className="text-sm text-ink-muted lg:col-start-2">
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
        <p className="text-sm text-ink-muted lg:col-start-2">
          Você poderá montar o cardápio com o caixa aberto, ou o catálogo completo será usado automaticamente.
        </p>
      )}

      <CardapioSalvoModal
        open={modalSalvoAberto}
        onClose={() => setModalSalvoAberto(false)}
        value={form.cardapioId}
        onChange={(cardapioId) => setForm({ ...form, cardapioId })}
        cardapios={cardapios}
        emptyMessage="Nenhum cardápio cadastrado. Crie em Cardápio → Cardápios salvos."
      />
    </div>
  );
}
