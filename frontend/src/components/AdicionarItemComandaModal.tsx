import { useEffect, useState } from 'react';
import type { Produto, TapComChope, VolumeMl } from '../types';
import { FORMATO_BEBIDA_LABELS } from '../types';
import { formatCurrency } from '../lib/api';
import { Modal } from './Modal';

type TabId = 'chope' | 'bebidas' | 'comidas';

const TABS: { id: TabId; label: string }[] = [
  { id: 'chope', label: 'Chopes' },
  { id: 'bebidas', label: 'Bebidas' },
  { id: 'comidas', label: 'Comidas' },
];

export function AdicionarItemComandaModal({
  open,
  onClose,
  tapsComChope,
  bebidas,
  comidas,
  eventoAberto,
  comandaTotal,
  onAdd,
  isPending,
  error,
  successMessage,
}: {
  open: boolean;
  onClose: () => void;
  tapsComChope: TapComChope[];
  bebidas: Produto[];
  comidas: Produto[];
  eventoAberto: boolean;
  comandaTotal: number;
  onAdd: (data: { produtoId: string; volumeMl: number; quantidade: number; tapId?: string }) => void;
  isPending: boolean;
  error?: string;
  successMessage?: string;
}) {
  const [tab, setTab] = useState<TabId>('chope');
  const [selectedTap, setSelectedTap] = useState<TapComChope | null>(null);
  const [selectedVolume, setSelectedVolume] = useState<VolumeMl | null>(null);
  const [selectedProduto, setSelectedProduto] = useState<Produto | null>(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (!open) return;
    setSelectedTap(tapsComChope[0] ?? null);
    setSelectedVolume(null);
    setSelectedProduto(null);
    setQuantity(1);
    if (tapsComChope.length > 0) setTab('chope');
    else if (bebidas.length > 0) setTab('bebidas');
    else setTab('comidas');
  }, [open, tapsComChope, bebidas.length, comidas.length]);

  useEffect(() => {
    if (!selectedTap?.chopeAtual) {
      setSelectedVolume(null);
      return;
    }
    const volumes = selectedTap.chopeAtual.precos.map((p) => p.volumeMl as VolumeMl);
    setSelectedVolume(volumes[0] ?? null);
  }, [selectedTap]);

  const chopePreco =
    selectedTap?.chopeAtual && selectedVolume
      ? selectedTap.chopeAtual.precos.find((p) => p.volumeMl === selectedVolume)
      : undefined;

  const unitProduto =
    tab !== 'chope' && selectedProduto ? selectedProduto.precos[0] : undefined;

  const unitPrice =
    tab === 'chope'
      ? chopePreco
        ? parseFloat(String(chopePreco.preco))
        : 0
      : unitProduto
        ? parseFloat(String(unitProduto.preco))
        : 0;

  const canAddChope = tab === 'chope' && !!selectedTap && !!selectedVolume && !!chopePreco;
  const canAddUnit = tab !== 'chope' && !!selectedProduto && !!unitProduto;
  const canAdd = (canAddChope || canAddUnit) && quantity > 0 && !isPending;

  const subtotal = unitPrice * quantity;
  const newTotal = comandaTotal + subtotal;

  const handleAdd = () => {
    if (tab === 'chope') {
      if (!selectedTap?.chopeAtual || !selectedVolume) return;
      onAdd({
        produtoId: selectedTap.chopeAtual.id,
        volumeMl: selectedVolume,
        quantidade: quantity,
        tapId: selectedTap.id,
      });
      return;
    }
    if (!selectedProduto || !unitProduto) return;
    onAdd({
      produtoId: selectedProduto.id,
      volumeMl: unitProduto.volumeMl,
      quantidade: quantity,
    });
  };

  const availableVolumes = (selectedTap?.chopeAtual?.precos ?? [])
    .map((p) => p.volumeMl as VolumeMl)
    .sort((a, b) => a - b);

  const nothingAvailable =
    tapsComChope.length === 0 && bebidas.length === 0 && comidas.length === 0;

  const renderEmpty = (message: string) => (
    <p className="text-sm text-ink-faint text-center py-8">{message}</p>
  );

  const footer = (
    <>
      <button
        type="button"
        className="touch-btn-primary w-full"
        onClick={handleAdd}
        disabled={!canAdd}
      >
        {isPending
          ? 'Adicionando...'
          : successMessage
            ? 'Adicionar novamente à comanda'
            : 'Adicionar à comanda'}
      </button>
      <button type="button" className="touch-btn-danger w-full" onClick={onClose} disabled={isPending}>
        Cancelar
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Adicionar item" hideHeaderClose footer={footer}>
      <div className="space-y-4">
        {error && <div className="alert-error text-sm">{error}</div>}
        {successMessage && <div className="alert-success text-sm" role="status">{successMessage}</div>}

        {nothingAvailable && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 space-y-2">
            <p className="font-semibold">Nada disponível para vender ainda</p>
            <ol className="list-decimal pl-4 space-y-1 text-amber-900">
              <li>Cadastre produtos em <strong>Config. → Catálogo</strong> (chopes, latas, comidas).</li>
              <li>Na tela <strong>Comandas</strong>, toque nos taps e monte os chopes do evento.</li>
              <li>Latas e comidas entram pelo cardápio do evento (editar em <strong>Eventos</strong>).</li>
            </ol>
          </div>
        )}

        <div className="segmented-control">
          {TABS.map(({ id, label }) => {
            const disabled =
              (id === 'chope' && tapsComChope.length === 0) ||
              (id === 'bebidas' && bebidas.length === 0) ||
              (id === 'comidas' && comidas.length === 0);
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setTab(id);
                  setSelectedProduto(null);
                  setQuantity(1);
                }}
                className={`segmented-control-btn ${
                  tab === id ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
                } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {tab === 'chope' && (
          <div className="space-y-4">
            {tapsComChope.length === 0 ? (
              renderEmpty(
                eventoAberto
                  ? 'Nenhum tap com chope montado. Volte à tela Comandas e toque nos taps para posicionar os chopes.'
                  : 'Nenhum tap com chope disponível.',
              )
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
                    Escolha o tap
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {tapsComChope.map((tap) => {
                      const selected = selectedTap?.id === tap.id;
                      const accent = tap.chopeAtual?.cor ?? '#94a3b8';
                      return (
                        <button
                          key={tap.id}
                          type="button"
                          onClick={() => setSelectedTap(tap)}
                          className="flex flex-col items-center gap-1.5 min-w-0"
                        >
                          <span
                            className={[
                              'flex h-14 w-14 items-center justify-center rounded-full border-2 text-sm font-bold transition-all',
                              selected ? 'scale-105 shadow-sm' : 'opacity-80',
                            ].join(' ')}
                            style={{
                              borderColor: selected ? accent : undefined,
                              backgroundColor: selected ? `${accent}22` : undefined,
                            }}
                          >
                            {String(tap.numero).padStart(2, '0')}
                          </span>
                          <span className="text-xs font-semibold text-ink-soft truncate w-full text-center leading-tight">
                            {tap.chopeAtual?.nome}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedTap && availableVolumes.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">
                      Volume
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {availableVolumes.map((vol) => {
                        const preco = selectedTap.chopeAtual?.precos.find((p) => p.volumeMl === vol);
                        return (
                          <button
                            key={vol}
                            type="button"
                            onClick={() => setSelectedVolume(vol)}
                            className={`min-h-12 rounded-xl text-sm font-semibold transition-colors ${
                              selectedVolume === vol
                                ? 'bg-brand-600 text-white'
                                : 'bg-surface border border-line text-ink-muted'
                            }`}
                          >
                            {vol} ml
                            {preco && (
                              <span className="block text-[10px] font-medium opacity-80 mt-0.5">
                                {formatCurrency(preco.preco)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'bebidas' && (
          <div className="space-y-3">
            {bebidas.length === 0 ? (
              renderEmpty('Nenhuma bebida no cardápio deste evento.')
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto pr-1">
                {bebidas.map((produto) => {
                  const preco = produto.precos[0];
                  const selected = selectedProduto?.id === produto.id;
                  const formato = produto.formato ? FORMATO_BEBIDA_LABELS[produto.formato] : 'Unidade';
                  return (
                    <button
                      key={produto.id}
                      type="button"
                      onClick={() => {
                        setSelectedProduto(produto);
                        setQuantity(1);
                      }}
                      className={[
                        'rounded-xl border-2 p-3 text-left min-h-[4.5rem] transition-colors',
                        selected
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-line bg-surface hover:border-brand-300',
                      ].join(' ')}
                    >
                      <p className="text-xs text-ink-faint">{formato}</p>
                      <p className="font-bold text-sm leading-snug">{produto.nome}</p>
                      {preco && (
                        <p className="text-brand-700 font-semibold text-sm mt-1">
                          {formatCurrency(preco.preco)}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'comidas' && (
          <div className="space-y-3">
            {comidas.length === 0 ? (
              renderEmpty('Nenhuma comida no cardápio deste evento.')
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto pr-1">
                {comidas.map((produto) => {
                  const preco = produto.precos[0];
                  const selected = selectedProduto?.id === produto.id;
                  return (
                    <button
                      key={produto.id}
                      type="button"
                      onClick={() => {
                        setSelectedProduto(produto);
                        setQuantity(1);
                      }}
                      className={[
                        'rounded-xl border-2 p-3 text-left min-h-[4.5rem] transition-colors',
                        selected
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-line bg-surface hover:border-brand-300',
                      ].join(' ')}
                    >
                      <p className="font-bold text-sm leading-snug">{produto.nome}</p>
                      {preco && (
                        <p className="text-brand-700 font-semibold text-sm mt-1">
                          {formatCurrency(preco.preco)}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(canAddChope || canAddUnit) && (
          <>
            <div>
              <p className="text-sm font-medium text-ink-muted mb-2">Quantidade</p>
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  aria-label="Diminuir quantidade"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1 || isPending}
                  className="min-h-12 min-w-12 rounded-xl bg-surface border border-line text-xl font-bold active:scale-95 disabled:opacity-30"
                >
                  −
                </button>
                <span className="text-3xl font-bold tabular-nums min-w-[2.5rem] text-center">{quantity}</span>
                <button
                  type="button"
                  aria-label="Aumentar quantidade"
                  onClick={() => setQuantity((q) => q + 1)}
                  disabled={isPending}
                  className="min-h-12 min-w-12 rounded-xl bg-surface border border-line text-xl font-bold active:scale-95"
                >
                  +
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-surface-lighter border border-line p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink leading-snug">
                    {tab === 'chope'
                      ? `${selectedTap?.chopeAtual?.nome} ${selectedVolume}ml`
                      : selectedProduto?.nome}
                  </p>
                  {tab === 'chope' && selectedTap && (
                    <p className="text-sm text-ink-muted">Tap {selectedTap.numero}</p>
                  )}
                  <p className="text-sm text-ink-faint mt-0.5">
                    {formatCurrency(unitPrice)} cada
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-ink-faint">Total</p>
                  <p className="text-lg font-bold text-brand-600 tabular-nums">
                    {formatCurrency(subtotal)}
                  </p>
                </div>
              </div>
              <p className="text-xs text-ink-faint pt-1 border-t border-line">
                Novo total da comanda: {formatCurrency(newTotal)}
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
