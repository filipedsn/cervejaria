import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import type { CardapioOperacao, CardapioTurnoOperacao, ProdutoOperacao } from '../../lib/operacao';
import { normalizeCategoriaProduto } from '../../lib/operacao';
import {
  CardapioOperacaoProdutosPicker,
  CardapioOperacaoProdutosResumo,
} from './CardapioOperacaoProdutosPicker';
import { CardapioSalvoModal, cardapioSalvoLabel } from '../CardapioSalvoModal';
import { Modal } from '../Modal';
import { CurrencyInput } from '../CurrencyInput';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../../lib/currency';

type CardapioModo = 'salvo' | 'montar';
type EscopoPreco = 'TURNO' | 'TEMPLATE';

type PendingPreco = {
  produto: ProdutoOperacao;
  precoUnit: number;
};

const precoKey = (produto: ProdutoOperacao) => `${produto.id}:${produto.volumeMl ?? 0}`;

export function OperacaoTurnoCardapioPanel({
  pontoVendaId,
  embedded = false,
  onClose,
}: {
  pontoVendaId: string;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<CardapioModo>('salvo');
  const [cardapioId, setCardapioId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [modalSalvoAberto, setModalSalvoAberto] = useState(false);
  const [pendingPreco, setPendingPreco] = useState<PendingPreco | null>(null);
  const [draftPrecos, setDraftPrecos] = useState<Record<string, string>>({});

  const { data: cardapio, isLoading } = useQuery({
    queryKey: ['operacao-turno-cardapio', pontoVendaId],
    queryFn: () =>
      api.get<CardapioTurnoOperacao>(
        `/api/operacao/caixa/cardapio?pontoVendaId=${encodeURIComponent(pontoVendaId)}`,
      ),
    enabled: Boolean(pontoVendaId),
  });

  const { data: cardapiosSalvos } = useQuery({
    queryKey: ['operacao-cardapios', 'ativo'],
    queryFn: () => api.get<CardapioOperacao[]>('/api/operacao/cardapios?ativo=true'),
    enabled: Boolean(pontoVendaId),
  });

  useEffect(() => {
    if (!cardapio) return;
    setSelectedIds(cardapio.produtoIds);
    setDirty(false);
    // Turno vinculado a um cardápio salvo continua em "salvo": trocar para
    // "montar" desvincula o template e tira a opção de preço definitivo.
    setModo(!cardapio.cardapioId && cardapio.produtoIds.length > 0 ? 'montar' : 'salvo');
    setCardapioId(cardapio.cardapioId ?? '');
    const next: Record<string, string> = {};
    for (const p of cardapio.produtos) {
      const valor = (p.precoEfetivo ?? parseFloat(p.precoUnit)) || 0;
      next[precoKey(p)] = formatCurrencyInputFromNumber(valor);
    }
    setDraftPrecos(next);
  }, [cardapio]);

  const saveMutation = useMutation({
    mutationFn: (payload: { cardapioId?: string; produtoIds?: string[] }) =>
      api.put<CardapioTurnoOperacao>(
        `/api/operacao/caixa/cardapio?pontoVendaId=${encodeURIComponent(pontoVendaId)}`,
        payload,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['operacao-turno-cardapio', pontoVendaId], data);
      queryClient.invalidateQueries({ queryKey: ['operacao-produtos-operacionais', pontoVendaId] });
      setSelectedIds(data.produtoIds);
      setDirty(false);
      setError('');
      onClose?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar cardápio'),
  });

  const precoMutation = useMutation({
    mutationFn: (payload: { produtoId: string; volumeMl: number; precoUnit: number; escopo: EscopoPreco }) =>
      api.patch<CardapioTurnoOperacao>(
        `/api/operacao/caixa/cardapio/preco?pontoVendaId=${encodeURIComponent(pontoVendaId)}`,
        payload,
      ),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['operacao-turno-cardapio', pontoVendaId], data);
      queryClient.invalidateQueries({ queryKey: ['operacao-produtos-operacionais', pontoVendaId] });
      if (variables.escopo === 'TEMPLATE') {
        queryClient.invalidateQueries({ queryKey: ['operacao-cardapios'] });
      }
      setPendingPreco(null);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao alterar preço'),
  });

  if (isLoading) return <p className="text-sm text-ink-faint py-2">Carregando cardápio...</p>;

  const podeEditar = cardapio?.editavel ?? true;
  const catalogo = cardapio?.catalogo ?? [];
  const hasCatalogo = catalogo.length > 0;
  const temItens = (cardapio?.produtos.length ?? 0) > 0;
  const cardapioVinculadoId = cardapio?.cardapioId ?? null;
  const cardapioVinculadoNome =
    cardapio?.cardapioNome ??
    cardapioSalvoLabel(cardapiosSalvos, cardapioVinculadoId ?? '') ??
    'cardápio salvo';
  const cardapioSelecionado =
    modo === 'salvo' && cardapioId
      ? (cardapiosSalvos?.find((c) => c.id === cardapioId) ?? null)
      : null;

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

  /**
   * Reaplicar o mesmo cardápio recria os itens do turno e apagaria os preços
   * ajustados, então só liberamos salvar quando algo realmente mudou.
   */
  const alteracaoPendente =
    modo === 'salvo' ? cardapioId !== (cardapioVinculadoId ?? '') : dirty;

  const canSave = alteracaoPendente && !saveMutation.isPending;

  const solicitarAlteracaoPreco = (produto: ProdutoOperacao, draft: string) => {
    const atual = (produto.precoEfetivo ?? parseFloat(produto.precoUnit)) || 0;
    const novo = parseCurrencyInput(draft);
    if (!(novo > 0)) {
      setDraftPrecos((prev) => ({
        ...prev,
        [precoKey(produto)]: formatCurrencyInputFromNumber(atual),
      }));
      return;
    }
    if (Math.abs(novo - atual) < 0.005) return;
    setPendingPreco({ produto, precoUnit: novo });
  };

  const cancelarPendingPreco = () => {
    if (pendingPreco) {
      const atual =
        (pendingPreco.produto.precoEfetivo ?? parseFloat(pendingPreco.produto.precoUnit)) || 0;
      setDraftPrecos((prev) => ({
        ...prev,
        [precoKey(pendingPreco.produto)]: formatCurrencyInputFromNumber(atual),
      }));
    }
    setPendingPreco(null);
  };

  const confirmarPreco = (escopo: EscopoPreco) => {
    if (!pendingPreco) return;
    precoMutation.mutate({
      produtoId: pendingPreco.produto.id,
      volumeMl: pendingPreco.produto.volumeMl ?? 0,
      precoUnit: pendingPreco.precoUnit,
      escopo,
    });
  };

  const closeButton = onClose ? (
    <button type="button" className="touch-btn-secondary w-full" onClick={onClose}>
      Fechar
    </button>
  ) : null;

  const descricao = podeEditar
    ? temItens
      ? 'Ajuste itens ou preços. Ao mudar um preço, escolha se vale só neste turno ou no cardápio salvo.'
      : 'Escolha um cardápio salvo ou selecione os itens manualmente.'
    : 'Itens disponíveis para venda neste turno.';

  return (
    <section className={embedded ? 'space-y-3' : 'space-y-2'}>
      {!embedded && (
        <div>
          <h2 className="section-label">Cardápio do turno</h2>
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
            Cadastre produtos no catálogo do operacao primeiro.
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
                  setSelectedIds(cardapio?.produtoIds ?? []);
                  setDirty(false);
                  if (value === 'salvo') {
                    setCardapioId(cardapioVinculadoId ?? '');
                    setModalSalvoAberto(true);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {modo === 'salvo' ? (
            cardapioSalvoLabel(cardapiosSalvos, cardapioId) ? (
              <p className="text-sm text-ink-muted">
                Selecionado:{' '}
                <span className="font-semibold text-ink">{cardapioSalvoLabel(cardapiosSalvos, cardapioId)}</span>
              </p>
            ) : null
          ) : (
            <CardapioOperacaoProdutosPicker catalogo={catalogo} selectedIds={selectedIds} onToggle={toggle} />
          )}

          <CardapioSalvoModal
            open={modalSalvoAberto}
            onClose={() => setModalSalvoAberto(false)}
            value={cardapioId}
            onChange={(id) => {
              setCardapioId(id);
              setError('');
            }}
            cardapios={cardapiosSalvos}
            emptyMessage="Nenhum cardápio cadastrado. Crie em Cardápio → Cardápios salvos."
          />

          {alteracaoPendente && (
            <div className="space-y-2">
              {cardapioSelecionado ? (
                <>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                    Itens deste cardápio
                    <span className="ml-1 font-medium normal-case text-ink-faint">
                      · {cardapioSelecionado.nome}
                    </span>
                  </h3>
                  <CardapioOperacaoProdutosResumo produtos={cardapioSelecionado.produtos ?? []} />
                </>
              ) : null}
              <p className="text-sm text-ink-faint bg-surface-lighter border border-line rounded-lg px-3 py-2">
                Salve o cardápio para aplicar no turno e liberar a edição de preços.
              </p>
            </div>
          )}

          {temItens && !alteracaoPendente && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                Preços neste turno
                <span className="ml-1 font-medium normal-case text-ink-faint">
                  {cardapioVinculadoId ? `· ${cardapioVinculadoNome}` : '· sem cardápio salvo'}
                </span>
              </h3>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {(cardapio?.produtos ?? []).map((p) => {
                  const valor = draftPrecos[precoKey(p)] ?? formatCurrencyInputFromNumber(p.precoEfetivo ?? 0);
                  return (
                    <div
                      key={precoKey(p)}
                      className="rounded-xl border border-line bg-surface p-2.5 flex flex-col sm:flex-row sm:items-center gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink leading-tight">{p.nome}{(p.volumeMl ?? 0) > 1 ? ` · ${p.volumeMl} ml` : ''}</p>
                        <p className="text-xs text-ink-faint mt-0.5">
                          {normalizeCategoriaProduto(p.categoria)}
                          {p.precoOverrideTurno ? ' · preço só deste turno' : ''}
                        </p>
                      </div>
                      {false ? (
                        <p className="text-xs text-ink-muted sm:max-w-56">
                          Preços por volume no cadastro:{' '}
                          {(p.precos ?? []).map((preco) => `${preco.volumeMl} ml ${formatCurrency(Number(preco.preco))}`).join(' · ')}
                        </p>
                      ) : (
                        <div className="w-full sm:w-36 shrink-0">
                          <CurrencyInput
                            className="input"
                            value={valor}
                            onChange={(v) => setDraftPrecos((prev) => ({ ...prev, [precoKey(p)]: v }))}
                            onBlur={(e) => solicitarAlteracaoPreco(p, e.currentTarget.value)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
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
          <CardapioOperacaoProdutosResumo produtos={cardapio?.produtos ?? []} />
          {closeButton}
        </div>
      )}

      <Modal
        open={!!pendingPreco}
        onClose={cancelarPendingPreco}
        title="Onde aplicar o novo preço?"
        hideHeaderClose
        footer={
          <div className="space-y-2 w-full">
            <button
              type="button"
              className="touch-btn-primary w-full"
              disabled={precoMutation.isPending}
              onClick={() => confirmarPreco('TURNO')}
            >
              Só neste turno
            </button>
            {cardapioVinculadoId ? (
              <button
                type="button"
                className="touch-btn-secondary w-full"
                disabled={precoMutation.isPending}
                onClick={() => confirmarPreco('TEMPLATE')}
              >
                Salvar no cardápio “{cardapioVinculadoNome}”
              </button>
            ) : null}
            <button
              type="button"
              className="touch-btn-secondary w-full"
              disabled={precoMutation.isPending}
              onClick={cancelarPendingPreco}
            >
              Cancelar
            </button>
          </div>
        }
      >
        {pendingPreco ? (
          <p className="text-sm text-ink-muted">
            Alterar <span className="font-semibold text-ink">{pendingPreco.produto.nome}</span> para{' '}
            <span className="font-semibold text-ink">{formatCurrency(pendingPreco.precoUnit)}</span>.
            {cardapioVinculadoId
              ? ' Escolha se a mudança vale só neste turno ou fica definitiva no cardápio salvo.'
              : ' Sem cardápio salvo vinculado, a mudança vale apenas neste turno.'}
          </p>
        ) : null}
      </Modal>
    </section>
  );
}
