import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { isChopeConfiguravelNaTapOperacao, type ProdutoOperacao, type TapsTurnoResposta } from '../../lib/operacao';

export function OperacaoTurnoTapsPanel({ pontoVendaId }: { pontoVendaId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['operacao-caixa-taps', pontoVendaId];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => api.get<TapsTurnoResposta>(`/api/operacao/caixa/taps?pontoVendaId=${encodeURIComponent(pontoVendaId)}`),
    enabled: Boolean(pontoVendaId),
  });
  const { data: produtos } = useQuery({
    queryKey: ['operacao-produtos-operacionais', pontoVendaId],
    queryFn: () => api.get<ProdutoOperacao[]>(`/api/operacao/produtos?pontoVendaId=${encodeURIComponent(pontoVendaId)}&incluirTodosChopes=true`),
    enabled: Boolean(pontoVendaId),
  });
  const chopes = [...new Map((produtos ?? []).filter((produto) => isChopeConfiguravelNaTapOperacao(produto)).map((produto) => [produto.id, produto])).values()];

  const montar = useMutation({
    mutationFn: ({ tapId, produtoId }: { tapId: string; produtoId: string }) =>
      api.put(`/api/operacao/caixa/taps/${tapId}/chope`, { pontoVendaId, produtoId }),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
  });
  const desmontar = useMutation({
    mutationFn: (tapId: string) => api.delete(`/api/operacao/caixa/taps/${tapId}/chope`, { pontoVendaId }),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
  });

  if (isLoading) return <p className="text-sm text-ink-faint">Carregando Taps do turno...</p>;
  if (error || !data) return <p className="text-sm text-ink-faint">Vincule um trailer ao abrir o turno para vender chope por Tap.</p>;
  if (!data.taps.length) return <p className="text-sm text-ink-faint">Este trailer ainda não possui Taps ativos.</p>;

  return <section className="card space-y-3 border-brand-500/30">
    <div><h2 className="text-lg font-semibold">Taps do turno</h2><p className="text-sm text-ink-muted">O chope montado aqui ficará disponível no PDV deste turno.</p></div>
    {data.taps.map((tap) => <div key={tap.id} className="grid gap-2 rounded-xl border border-line bg-surface-lighter p-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)] sm:items-center">
      <div><p className="font-semibold">Tap {tap.numero}{tap.nome ? ` · ${tap.nome}` : ''}</p><p className="text-sm text-ink-muted">{tap.chopeAtual?.nome ?? 'Sem chope montado'}</p></div>
      <div className="flex gap-2"><select className="input min-w-0 flex-1" value={tap.chopeAtual?.id ?? ''} onChange={(event) => { if (event.target.value) montar.mutate({ tapId: tap.id, produtoId: event.target.value }); else desmontar.mutate(tap.id); }} disabled={montar.isPending || desmontar.isPending}><option value="">Sem chope</option>{chopes.map((produto) => <option key={produto.id} value={produto.id}>{produto.nome}</option>)}</select></div>
    </div>)}
    {(montar.error || desmontar.error) && <p className="text-sm text-red-600">{(montar.error instanceof ApiError ? montar.error.message : desmontar.error instanceof ApiError ? desmontar.error.message : 'Não foi possível atualizar o Tap')}</p>}
  </section>;
}
