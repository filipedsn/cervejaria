import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { Produto, TapComChope, TapMontagemResponse } from '../types';
import { isBebidaChope } from '../types';
import { Modal } from './Modal';
import { Loading } from './Loading';

type TapModalMode = 'menu' | 'trocar' | 'confirm-trocar';

export function TapChopeBadge({ tap, compact, variant = 'card' }: { tap: TapComChope; compact?: boolean; variant?: 'hero' | 'card' }) {
  const size = compact ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5';
  const heroMuted = variant === 'hero';

  if (!tap.ativo) {
    return (
      <span className={`uppercase tracking-wide font-bold rounded ${size} ${heroMuted ? 'text-white/80 bg-white/20' : 'text-ink-muted bg-line'}`}>
        off
      </span>
    );
  }
  if (tap.trocadoNoEvento) {
    return (
      <span className={`uppercase tracking-wide font-bold rounded ${size} text-amber-900 bg-amber-200`}>
        troca
      </span>
    );
  }
  if (tap.chopeAtual || tap.montagemPrevista) {
    return (
      <span className={`uppercase tracking-wide font-bold rounded ${size} ${heroMuted ? 'text-brand-100 bg-brand-600/80' : 'text-brand-800 bg-brand-100'}`}>
        tap
      </span>
    );
  }
  return null;
}

export function TapEventoGrid({
  taps,
  variant = 'card',
  interactive = false,
  onTapClick,
}: {
  taps: TapComChope[];
  variant?: 'hero' | 'card';
  interactive?: boolean;
  onTapClick?: (tap: TapComChope) => void;
}) {
  const isHero = variant === 'hero';
  const maxCols = isHero ? 4 : 3;
  const cols = Math.min(Math.max(taps.length, 1), maxCols);

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {taps.map((tap) => {
        const chopeNome = tap.chopeAtual?.nome ?? (tap.ativo ? 'Sem chope' : 'Inativa');
        const accentColor = tap.ativo && tap.chopeAtual?.cor ? tap.chopeAtual.cor : isHero ? 'rgba(255,255,255,0.35)' : '#d1d5db';
        const Tag = interactive ? 'button' : 'div';

        return (
          <Tag
            key={tap.id}
            type={interactive ? 'button' : undefined}
            onClick={interactive ? () => onTapClick?.(tap) : undefined}
            className={[
              'relative min-w-0 overflow-hidden rounded-xl border-2 text-left transition-all',
              isHero
                ? 'min-h-[4.25rem] flex flex-col justify-center p-2.5 pt-3'
                : 'min-h-[3.75rem] flex flex-col justify-center p-2 pt-2.5',
              isHero
                ? 'bg-white/15 border-white/25 text-white'
                : 'bg-surface border-line shadow-sm',
              interactive && !isHero && 'hover:border-brand-400 hover:shadow-md active:scale-[0.98]',
              interactive && isHero && 'hover:bg-white/25 active:scale-[0.98]',
              !tap.ativo && 'opacity-50 saturate-50',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div
              className="absolute inset-x-0 top-0 h-1.5"
              style={{ backgroundColor: accentColor }}
              aria-hidden
            />

            <div className="flex items-start justify-between gap-1 mt-1 min-w-0">
              <p
                className={`font-semibold leading-snug line-clamp-2 min-w-0 ${isHero ? 'text-sm text-white' : 'text-xs text-ink'}`}
                title={`TAP ${tap.numero} - ${chopeNome}`}
              >
                <span className="font-bold uppercase tracking-wide">TAP {tap.numero}</span>
                <span className={isHero ? 'text-white/75' : 'text-ink-muted'}> - </span>
                <span>{chopeNome}</span>
              </p>
              <TapChopeBadge tap={tap} compact variant={variant} />
            </div>
          </Tag>
        );
      })}
    </div>
  );
}

export function EventoTapMontagemPanel({
  eventoId,
  eventoAberto,
  sectionId,
  variant = 'card',
  presentation = 'inline',
}: {
  eventoId: string;
  eventoAberto: boolean;
  sectionId?: string;
  variant?: 'hero' | 'card';
  presentation?: 'inline' | 'modal';
}) {
  const queryClient = useQueryClient();
  const [selectedTap, setSelectedTap] = useState<TapComChope | null>(null);
  const [modalMode, setModalMode] = useState<TapModalMode>('menu');
  const [montagemProdutoId, setMontagemProdutoId] = useState('');
  const [error, setError] = useState('');
  const [showTapsModal, setShowTapsModal] = useState(false);

  const { data: taps, isLoading } = useQuery({
    queryKey: ['evento-taps', eventoId],
    queryFn: () => api.get<TapComChope[]>(`/api/eventos/${eventoId}/taps`),
    enabled: !!eventoId,
  });

  const { data: produtos } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => api.get<Produto[]>('/api/produtos'),
  });

  const chopes = produtos?.filter((p) => p.ativo && isBebidaChope(p)) ?? [];

  useEffect(() => {
    if (!eventoId) return;
    const socket = getSocket();
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['evento-taps', eventoId] });
    };
    socket.on('tap-montagem:updated', handler);
    return () => {
      socket.off('tap-montagem:updated', handler);
    };
  }, [eventoId, queryClient]);

  const closeModal = () => {
    setSelectedTap(null);
    setModalMode('menu');
    setMontagemProdutoId('');
  };

  const closeTapsModal = () => {
    setShowTapsModal(false);
    closeModal();
  };

  const openTap = (tap: TapComChope) => {
    if (!eventoAberto) return;
    setSelectedTap(tap);
    setModalMode('menu');
    setMontagemProdutoId(tap.chopeAtual?.id ?? '');
    setError('');
  };

  const montagemMutation = useMutation({
    mutationFn: ({ tapId, produtoId }: { tapId: string; produtoId: string }) =>
      api.put<TapMontagemResponse>(`/api/eventos/${eventoId}/taps/${tapId}/chope`, { produtoId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evento-taps', eventoId] });
      closeModal();
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao posicionar chope'),
  });

  const desmontagemMutation = useMutation({
    mutationFn: (tapId: string) =>
      api.delete<TapComChope[]>(`/api/eventos/${eventoId}/taps/${tapId}/chope`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evento-taps', eventoId] });
      closeModal();
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao remover chope'),
  });

  const ativoMutation = useMutation({
    mutationFn: ({ tapId, ativo }: { tapId: string; ativo: boolean }) =>
      api.patch<TapMontagemResponse>(`/api/eventos/${eventoId}/taps/${tapId}/ativo`, { ativo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evento-taps', eventoId] });
      closeModal();
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao alterar tap'),
  });

  const isModal = presentation === 'modal';

  if (isLoading) {
    if (variant === 'hero') return null;
    if (!isModal) return <Loading />;
  }

  const prevista = taps?.some((t) => t.montagemPrevista);
  const label = prevista ? 'Montagem prevista' : variant === 'hero' ? 'Chopes no evento' : 'Taps do evento';
  const isHero = variant === 'hero';

  const showHeader = isHero || prevista;

  const semChope = eventoAberto && !!taps?.length && taps.every((t) => !t.chopeAtual);
  const needsAttention = !!prevista || semChope;
  const totalTaps = taps?.length ?? 0;
  const comChope = taps?.filter((t) => t.chopeAtual).length ?? 0;

  const onboardingHint = (
    <>
      {isHero && eventoAberto && semChope && (
        <p className="text-xs text-white/85 leading-snug rounded-lg bg-white/10 px-3 py-2">
          Toque em cada tap abaixo e escolha qual chope está na torneira. Só depois disso dá para vender chope nas comandas.
        </p>
      )}
      {!isHero && eventoAberto && semChope && (
        <p className="text-sm text-ink-muted leading-snug rounded-lg bg-surface-lighter border border-line px-3 py-2">
          Toque em cada tap e escolha qual chope está na torneira. Só depois disso dá para vender chope nas comandas.
        </p>
      )}
    </>
  );

  const gridBody = isLoading ? (
    <Loading />
  ) : !taps?.length ? (
    !isHero && (
      <p className="text-sm text-ink-faint text-center py-4">Nenhum tap cadastrado no trailer deste evento.</p>
    )
  ) : (
    <>
      {onboardingHint}
      <TapEventoGrid
        taps={taps}
        variant={variant}
        interactive={eventoAberto}
        onTapClick={openTap}
      />
    </>
  );

  const tapDetailTitle = selectedTap
    ? modalMode === 'trocar' || modalMode === 'confirm-trocar'
      ? `Tap ${selectedTap.numero} — ${selectedTap.chopeAtual ? 'Trocar chope' : 'Posicionar chope'}`
      : `Tap ${selectedTap.numero}${selectedTap.nome ? ` — ${selectedTap.nome}` : ''}`
    : '';

  const errorBanner = error ? (
    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
      {error}
    </p>
  ) : null;

  const tapDetailBody = selectedTap && (
    <>
      {errorBanner}
      {modalMode === 'menu' && (
            <div className="space-y-2">
              {selectedTap.chopeAtual && (
                <p className="text-sm text-ink-muted mb-3">
                  Chope: <span className="font-semibold text-ink">{selectedTap.chopeAtual.nome}</span>
                </p>
              )}

              {selectedTap.ativo ? (
                <>
                  <button
                    type="button"
                    className="touch-btn-primary w-full"
                    onClick={() => {
                      setMontagemProdutoId(selectedTap.chopeAtual?.id ?? '');
                      setModalMode('trocar');
                    }}
                  >
                    {selectedTap.chopeAtual ? 'Trocar chope' : 'Posicionar chope'}
                  </button>
                  {selectedTap.chopeAtual && (
                    <button
                      type="button"
                      className="touch-btn-secondary w-full"
                      disabled={desmontagemMutation.isPending}
                      onClick={() => desmontagemMutation.mutate(selectedTap.id)}
                    >
                      {desmontagemMutation.isPending ? 'Removendo...' : 'Remover chope'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="touch-btn-secondary w-full"
                    disabled={ativoMutation.isPending}
                    onClick={() => ativoMutation.mutate({ tapId: selectedTap.id, ativo: false })}
                  >
                    {ativoMutation.isPending ? 'Salvando...' : 'Inativar tap'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="touch-btn-primary w-full"
                  disabled={ativoMutation.isPending}
                  onClick={() => ativoMutation.mutate({ tapId: selectedTap.id, ativo: true })}
                >
                  {ativoMutation.isPending ? 'Salvando...' : 'Reativar tap'}
                </button>
              )}

              <button type="button" className="touch-btn-secondary w-full" onClick={closeModal}>
                Cancelar
              </button>
            </div>
          )}

          {modalMode === 'confirm-trocar' && (
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">Confirmar troca:</p>
              <p className="font-semibold">
                {selectedTap.chopeAtual?.nome ?? 'vazio'} → {chopes.find((p) => p.id === montagemProdutoId)?.nome}
              </p>
              <div className="flex gap-2">
                <button type="button" className="touch-btn-orange flex-1" onClick={() => setModalMode('trocar')}>
                  Voltar
                </button>
                <button
                  type="button"
                  className="touch-btn-primary flex-1"
                  disabled={montagemMutation.isPending}
                  onClick={() => montagemMutation.mutate({ tapId: selectedTap.id, produtoId: montagemProdutoId })}
                >
                  {montagemMutation.isPending ? 'Salvando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}

          {modalMode === 'trocar' && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!montagemProdutoId) return;
                const isSwap = selectedTap.chopeAtual && montagemProdutoId !== selectedTap.chopeAtual.id;
                if (isSwap) {
                  setModalMode('confirm-trocar');
                  return;
                }
                montagemMutation.mutate({ tapId: selectedTap.id, produtoId: montagemProdutoId });
              }}
            >
              <div>
                <label className="label">Chope</label>
                {chopes.length === 0 ? (
                  <p className="text-sm text-ink-muted rounded-lg border border-line bg-surface-lighter px-3 py-3">
                    Nenhum chope no catálogo. Cadastre em <strong>Config. → Catálogo</strong> (tipo bebida, formato chope) e volte aqui.
                  </p>
                ) : (
                  <select
                    className="input"
                    value={montagemProdutoId}
                    onChange={(e) => setMontagemProdutoId(e.target.value)}
                    required
                  >
                    <option value="">Selecione o chope</option>
                    {chopes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <button
                type="submit"
                className="touch-btn-primary w-full"
                disabled={montagemMutation.isPending || !montagemProdutoId || chopes.length === 0}
              >
                {montagemMutation.isPending ? 'Salvando...' : selectedTap.chopeAtual ? 'Continuar' : 'Posicionar'}
              </button>
              <button type="button" className="touch-btn-orange w-full" onClick={() => setModalMode('menu')}>
                Voltar
              </button>
            </form>
          )}
    </>
  );

  if (isModal) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowTapsModal(true)}
          className="touch-btn-secondary touch-btn-sm inline-flex w-full min-h-12 items-center justify-center gap-2 px-3"
        >
          <span aria-hidden>🍺</span>
          <span>Taps do evento</span>
          <span className="text-ink-faint">
            {totalTaps > 0 ? `(${comChope}/${totalTaps})` : ''}
          </span>
          {needsAttention && (
            <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
          )}
        </button>

        <Modal
          open={showTapsModal}
          onClose={closeTapsModal}
          title={selectedTap ? tapDetailTitle : prevista ? 'Montagem prevista' : 'Taps do evento'}
          hideHeaderClose
          footer={
            <button type="button" className="touch-btn-secondary w-full" onClick={closeTapsModal}>
              Fechar
            </button>
          }
        >
          {selectedTap ? (
            tapDetailBody
          ) : (
            <div className="space-y-2">
              {errorBanner}
              {gridBody}
            </div>
          )}
        </Modal>
      </>
    );
  }

  return (
    <section id={sectionId} className="space-y-2 scroll-mt-4">
      {showHeader && (
        <div>
          <h2
            className={
              isHero
                ? 'text-xs font-bold uppercase tracking-wide text-white/80'
                : 'section-label'
            }
          >
            {label}
          </h2>
        </div>
      )}

      {error && (
        <p
          className={
            isHero
              ? 'text-sm text-red-100 bg-red-900/40 border border-red-400/40 rounded-lg px-3 py-2'
              : 'text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2'
          }
        >
          {error}
        </p>
      )}

      {gridBody}

      {selectedTap && (
        <Modal open onClose={closeModal} title={tapDetailTitle}>
          {tapDetailBody}
        </Modal>
      )}
    </section>
  );
}
