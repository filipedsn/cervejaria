import { useEffect, useState } from 'react';
import type { Produto, TapComChope, VolumeMl } from '../types';
import { formatCurrency } from '../lib/api';
import { normalizeCategoriaProduto } from '../lib/operacao';
import { Modal } from './Modal';

type TabId = 'chope' | 'comidas' | 'bebidas' | 'outros';

export function AdicionarItemComandaModal({
  open,
  onClose,
  tapsComChope,
  bebidas,
  comidas,
  outros = [],
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
  outros?: Produto[];
  eventoAberto: boolean;
  comandaTotal: number;
  onAdd: (data: { produtoId: string; volumeMl: number; quantidade: number; tapId?: string; paraViagem?: boolean; observacao?: string; opcionais?: { opcionalId: string; quantidade: number }[] }) => void;
  isPending: boolean;
  error?: string;
  successMessage?: string;
}) {
  const [tab, setTab] = useState<TabId>('comidas');
  const [selectedTap, setSelectedTap] = useState<TapComChope | null>(null);
  const [selectedVolume, setSelectedVolume] = useState<VolumeMl | null>(null);
  const [selectedProduto, setSelectedProduto] = useState<Produto | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [paraViagem, setParaViagem] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [opcionais, setOpcionais] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    setSelectedTap(tapsComChope[0] ?? null);
    setSelectedVolume(null);
    setSelectedProduto(null);
    setQuantity(1);
    setParaViagem(false);
    setObservacao('');
    setOpcionais({});
    setTab(comidas.length ? 'comidas' : bebidas.length ? 'bebidas' : outros.length ? 'outros' : tapsComChope.length ? 'chope' : 'comidas');
  }, [open, tapsComChope, bebidas.length, comidas.length, outros.length]);

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

  const opcionaisTotal = Object.entries(opcionais).reduce((sum, [id, qty]) => {
    const option = selectedProduto?.gruposOpcionais?.flatMap((g) => g.opcoes).find((o) => o.id === id);
    return sum + Number(option?.precoAdicional ?? 0) * qty;
  }, 0);
  const subtotal = (unitPrice + opcionaisTotal) * quantity;
  const newTotal = comandaTotal + subtotal;

  const handleAdd = () => {
    if (tab === 'chope') {
      if (!selectedTap?.chopeAtual || !selectedVolume) return;
      onAdd({
        produtoId: selectedTap.chopeAtual.id,
        volumeMl: selectedVolume,
        quantidade: quantity,
        tapId: selectedTap.id,
        paraViagem,
      });
      return;
    }
    if (!selectedProduto || !unitProduto) return;
    onAdd({
      produtoId: selectedProduto.id,
      volumeMl: unitProduto.volumeMl,
      quantidade: quantity,
      paraViagem,
      observacao: observacao.trim() || undefined,
      opcionais: Object.entries(opcionais).map(([opcionalId, quantidade]) => ({ opcionalId, quantidade })),
    });
  };

  const availableVolumes = (selectedTap?.chopeAtual?.precos ?? [])
    .map((p) => p.volumeMl as VolumeMl)
    .sort((a, b) => a - b);

  const nothingAvailable =
    tapsComChope.length === 0 && bebidas.length === 0 && comidas.length === 0 && outros.length === 0;
  const visibleTabs: { id: TabId; label: string }[] = [
    ...(tapsComChope.length > 0 ? [{ id: 'chope' as const, label: 'Chopes' }] : []),
    ...(comidas.length > 0 ? [{ id: 'comidas' as const, label: 'Comidas' }] : []),
    ...(bebidas.length > 0 ? [{ id: 'bebidas' as const, label: 'Bebidas' }] : []),
    ...(outros.length > 0 ? [{ id: 'outros' as const, label: 'Outros' }] : []),
  ];
  const produtosDaAba = tab === 'bebidas' ? bebidas : tab === 'comidas' ? comidas : outros;
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
      <button type="button" className="touch-btn-orange w-full" onClick={onClose} disabled={isPending}>
        Voltar
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
          {visibleTabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  setSelectedProduto(null);
                  setQuantity(1);
                  setParaViagem(false);
                }}
                className={`segmented-control-btn ${
                  tab === id ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
                }`}
              >
                {label}
              </button>
          ))}
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
                  const categoria = normalizeCategoriaProduto(produto.categoria);
                  return (
                    <button
                      key={produto.id}
                      type="button"
                      onClick={() => {
                        setSelectedProduto(produto);
                        setQuantity(1);
                        setParaViagem(false);
                        setOpcionais({});
                      }}
                      className={[
                        'rounded-xl border-2 p-3 text-left min-h-[4.5rem] transition-colors',
                        selected
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-line bg-surface hover:border-brand-300',
                      ].join(' ')}
                    >
                      <p className="text-xs text-ink-faint">{categoria}</p>
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

        {(tab === 'comidas' || tab === 'outros') && (
          <div className="space-y-3">
            {produtosDaAba.length === 0 ? (
              renderEmpty('Nenhuma comida no cardápio deste evento.')
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto pr-1">
                {produtosDaAba.map((produto) => {
                  const preco = produto.precos[0];
                  const selected = selectedProduto?.id === produto.id;
                  const categoria = normalizeCategoriaProduto(produto.categoria);
                  return (
                    <button
                      key={produto.id}
                      type="button"
                      onClick={() => {
                        setSelectedProduto(produto);
                        setQuantity(1);
                        setParaViagem(false);
                        setOpcionais({});
                      }}
                      className={[
                        'rounded-xl border-2 p-3 text-left min-h-[4.5rem] transition-colors',
                        selected
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-line bg-surface hover:border-brand-300',
                      ].join(' ')}
                    >
                      <p className="text-xs text-ink-faint">{categoria}</p>
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
            {tab !== 'chope' && selectedProduto?.gruposOpcionais?.map((grupo) => (
              <div key={grupo.id} className="rounded-xl border border-line p-3">
                <p className="text-sm font-semibold">{grupo.nome}{grupo.obrigatorio ? ' *' : ''}</p>
                <div className="mt-2 space-y-2">
                  {grupo.opcoes.map((opcao) => {
                    const checked = Boolean(opcionais[opcao.id]);
                    return <label key={opcao.id} className="flex items-center gap-2 text-sm">
                      <input type={grupo.maximo === 1 ? 'radio' : 'checkbox'} name={`grupo-${grupo.id}`} checked={checked} onChange={() => setOpcionais((atual) => {
                        const next = { ...atual };
                        if (checked) delete next[opcao.id];
                        else { if (grupo.maximo === 1) grupo.opcoes.forEach((item) => delete next[item.id]); next[opcao.id] = 1; }
                        return next;
                      })} />
                      <span>{opcao.nome}{Number(opcao.precoAdicional) > 0 ? ` (+${formatCurrency(Number(opcao.precoAdicional))})` : ''}</span>
                    </label>;
                  })}
                </div>
              </div>
            ))}
            {canAddUnit && <label className="flex items-center gap-3 rounded-xl border border-line bg-surface-lighter px-3 py-3 text-sm font-semibold">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-600"
                checked={paraViagem}
                onChange={(event) => setParaViagem(event.target.checked)}
              />
              <span>
                <span className="block">Para viagem</span>
                <span className="block text-xs font-normal text-ink-muted">O item deve ser embalado.</span>
              </span>
            </label>}
            {canAddUnit && <label className="block text-sm"><span className="font-semibold">Observação do item</span><textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={280} rows={2} placeholder="Ex.: sem cebola" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2" /></label>}
          </>
        )}
      </div>
    </Modal>
  );
}
