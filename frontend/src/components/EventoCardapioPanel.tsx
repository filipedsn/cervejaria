import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { Cardapio, EventoCardapio } from '../types';
import { CardapioProdutosPicker, CardapioProdutosResumo } from './CardapioProdutosPicker';
import { Loading } from './Loading';

type CardapioModo = 'salvo' | 'montar';

export function EventoCardapioPanel({
  eventoId,
  eventoAberto,
  embedded = false,
  onClose,
}: {
  eventoId: string;
  eventoAberto: boolean;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<CardapioModo>('salvo');
  const [cardapioId, setCardapioId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  const { data: cardapio, isLoading } = useQuery({
    queryKey: ['evento-cardapio', eventoId],
    queryFn: () => api.get<EventoCardapio>(`/api/eventos/${eventoId}/cardapio`),
    enabled: !!eventoId,
  });

  const { data: cardapiosSalvos } = useQuery({
    queryKey: ['cardapios', 'ativo'],
    queryFn: () => api.get<Cardapio[]>('/api/cardapios?ativo=true'),
    enabled: !!eventoId,
  });

  useEffect(() => {
    if (cardapio) {
      setSelectedIds(cardapio.produtoIds);
      setDirty(false);
      setModo(cardapio.produtoIds.length > 0 ? 'montar' : 'salvo');
    }
  }, [cardapio]);

  useEffect(() => {
    if (!eventoId) return;
    const socket = getSocket();
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['evento-cardapio', eventoId] });
    };
    socket.on('evento-cardapio:updated', handler);
    return () => {
      socket.off('evento-cardapio:updated', handler);
    };
  }, [eventoId, queryClient]);

  const saveMutation = useMutation({
    mutationFn: (payload: { cardapioId?: string; produtoIds?: string[] }) =>
      api.put<EventoCardapio>(`/api/eventos/${eventoId}/cardapio`, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['evento-cardapio', eventoId], data);
      setSelectedIds(data.produtoIds);
      setDirty(false);
      setError('');
      onClose?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar cardápio'),
  });

  if (isLoading) return <Loading />;

  const podeEditar = cardapio?.editavel ?? true;
  const catalogo = cardapio?.catalogo ?? [];
  const hasCatalogo = catalogo.length > 0;
  const temItens = (cardapio?.produtos.length ?? 0) > 0;

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setDirty(true);
    setError('');
  };

  const handleSave = () => {
    if (modo === 'salvo') {
      if (!cardapioId) {
        setError('Selecione um cardápio salvo.');
        return;
      }
      saveMutation.mutate({ cardapioId });
      return;
    }
    saveMutation.mutate({ produtoIds: selectedIds });
  };

  const canSave =
    modo === 'salvo'
      ? !!cardapioId && !saveMutation.isPending
      : dirty && !saveMutation.isPending;

  const closeButton = onClose ? (
    <button type="button" className="touch-btn-secondary w-full" onClick={onClose}>
      Fechar
    </button>
  ) : null;

  const descricao = podeEditar
    ? temItens
      ? 'Adicione ou remova itens do cardápio deste evento.'
      : 'Escolha um cardápio salvo ou selecione os itens manualmente.'
    : 'Itens disponíveis para venda neste evento.';

  return (
    <section className={embedded ? 'space-y-3' : 'space-y-2'}>
      {!embedded && (
        <div>
          <h2 className="section-label">Comida e outras bebidas</h2>
          <p className="text-sm text-ink-muted mt-1">{descricao}</p>
        </div>
      )}

      {embedded && <p className="text-sm text-ink-muted">{descricao}</p>}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {!hasCatalogo ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-faint text-center py-3">
            Cadastre comida e bebidas em lata/garrafa no catálogo primeiro.
          </p>
          {closeButton}
        </div>
      ) : podeEditar ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['salvo', 'Cardápio salvo'],
                ['montar', 'Montar manual'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`min-h-11 rounded-xl text-xs font-semibold px-2 leading-tight ${
                  modo === value ? 'bg-brand-600 text-white' : 'bg-surface-lighter text-ink-muted'
                }`}
                onClick={() => {
                  setModo(value);
                  setError('');
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {modo === 'salvo' ? (
            <div>
              <label className="label">Selecione o cardápio</label>
              <select
                className="input"
                value={cardapioId}
                onChange={(e) => {
                  setCardapioId(e.target.value);
                  setError('');
                }}
              >
                <option value="">Escolha um cardápio</option>
                {(cardapiosSalvos ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.itemCount ?? c.produtos?.length ?? 0} itens)
                  </option>
                ))}
              </select>
              {(cardapiosSalvos?.length ?? 0) === 0 && (
                <p className="text-xs text-ink-faint mt-1">
                  Nenhum cardápio cadastrado. Crie em Configurações → Cardápios.
                </p>
              )}
            </div>
          ) : (
            <CardapioProdutosPicker catalogo={catalogo} selectedIds={selectedIds} onToggle={toggle} />
          )}

          <div className="space-y-2">
            <button
              type="button"
              className="touch-btn-primary w-full"
              disabled={!canSave}
              onClick={handleSave}
            >
              {saveMutation.isPending ? 'Salvando...' : 'Salvar cardápio'}
            </button>
            {closeButton}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <CardapioProdutosResumo produtos={cardapio?.produtos ?? []} />
          {closeButton}
        </div>
      )}
    </section>
  );
}
