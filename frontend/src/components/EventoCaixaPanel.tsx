import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency, ApiError } from '../lib/api';
import { CurrencyInput } from './CurrencyInput';
import { Modal } from './Modal';
import { parseCurrencyInput, formatCurrencyInputFromNumber } from '../lib/currency';

type Forma = 'DINHEIRO' | 'PIX' | 'CARTAO' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO';
type CaixaEvento = {
  id: string;
  status: 'ABERTO' | 'FECHADO';
  trocoInicial: number;
  abertoEm: string;
  fechadoEm: string | null;
  esperado: Record<Forma, number>;
  contado: Record<Forma, number> | null;
  divergencia: Record<Forma, number> | null;
  movimentos: Array<{ id: string; tipo: 'SUPRIMENTO' | 'SANGRIA'; valor: number; observacao: string | null }>;
};
type CaixaEventoResponse = { caixa: CaixaEvento | null; aberto: boolean };
type ContaEvento = { id: string; saldo: number };

const FORMAS: Array<{ id: Forma; label: string }> = [
  { id: 'DINHEIRO', label: 'Dinheiro contado' },
  { id: 'PIX', label: 'PIX recebido' },
  { id: 'CARTAO', label: 'Cartão (sem modalidade)' },
  { id: 'CARTAO_DEBITO', label: 'Cartão débito' },
  { id: 'CARTAO_CREDITO', label: 'Cartão crédito' },
];

export function EventoCaixaPanel({ eventoId, comandasAbertas = 0, eventoAberto = true }: { eventoId: string; comandasAbertas?: number; eventoAberto?: boolean }) {
  const queryClient = useQueryClient();
  const [trocoInicial, setTrocoInicial] = useState(() => formatCurrencyInputFromNumber(0));
  const [dialog, setDialog] = useState<'movimento' | 'fechar' | null>(null);
  const [tipoMovimento, setTipoMovimento] = useState<'SUPRIMENTO' | 'SANGRIA'>('SUPRIMENTO');
  const [valorMovimento, setValorMovimento] = useState('');
  const [observacao, setObservacao] = useState('');
  const [contado, setContado] = useState<Record<Forma, string>>({ DINHEIRO: '', PIX: '', CARTAO: '', CARTAO_DEBITO: '', CARTAO_CREDITO: '' });
  const [observacaoFechamento, setObservacaoFechamento] = useState('');
  const [error, setError] = useState('');

  const caixaQuery = useQuery({
    queryKey: ['evento-caixa', eventoId],
    queryFn: () => api.get<CaixaEventoResponse>(`/api/eventos/${eventoId}/caixa`),
    refetchInterval: 30_000,
  });
  const contasQuery = useQuery({
    queryKey: ['evento-contas-pendentes', eventoId],
    queryFn: () => api.get<ContaEvento[]>(`/api/eventos/${eventoId}/contas-pendentes`),
    refetchInterval: 30_000,
  });
  const caixa = caixaQuery.data?.caixa ?? null;
  const aberto = caixaQuery.data?.aberto ?? false;
  const temPendente = contasQuery.data?.some((conta) => conta.saldo > 0) ?? false;
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['evento-caixa', eventoId] }),
      queryClient.invalidateQueries({ queryKey: ['evento-contas-pendentes', eventoId] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', eventoId] }),
    ]);
  };
  const abrir = useMutation({
    mutationFn: () => api.post<CaixaEventoResponse>(`/api/eventos/${eventoId}/caixa/abrir`, { trocoInicial: parseCurrencyInput(trocoInicial) }),
    onSuccess: async () => { setError(''); setTrocoInicial(''); await refresh(); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Não foi possível abrir o caixa do evento'),
  });
  const registrarMovimento = useMutation({
    mutationFn: () => api.post(`/api/eventos/${eventoId}/caixa/movimentos`, { tipo: tipoMovimento, valor: parseCurrencyInput(valorMovimento), observacao: observacao.trim() || undefined }),
    onSuccess: async () => { setError(''); setDialog(null); setValorMovimento(''); setObservacao(''); await refresh(); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Não foi possível registrar o movimento'),
  });
  const fechar = useMutation({
    mutationFn: () => api.post<CaixaEventoResponse>(`/api/eventos/${eventoId}/caixa/fechar`, {
      contadoDinheiro: parseCurrencyInput(contado.DINHEIRO), contadoPix: parseCurrencyInput(contado.PIX),
      contadoDebito: parseCurrencyInput(contado.CARTAO_DEBITO), contadoCredito: parseCurrencyInput(contado.CARTAO_CREDITO),
      contadoCartao: parseCurrencyInput(contado.CARTAO),
      observacaoFechamento: observacaoFechamento.trim() || undefined,
    }),
    onSuccess: async () => { setError(''); setDialog(null); await refresh(); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Não foi possível fechar o caixa'),
  });

  return (
    <section className="card space-y-3 border-brand-600/20 bg-gradient-to-br from-surface via-surface to-brand-900/10 p-4 sm:p-5" aria-label="Caixa do evento">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div><h2 className="text-lg font-bold sm:text-xl">Caixa do evento</h2><p className="text-sm text-ink-muted">Abertura, recebimentos e conferência deste evento.</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${aberto ? 'bg-green-500/10 text-green-600' : 'bg-surface-lighter text-ink-muted'}`}>{aberto ? 'Em operação' : 'Fechado'}</span>
      </header>

      {error && <div className="alert-error" role="alert">{error}</div>}
      {caixaQuery.isLoading ? <p className="text-sm text-ink-muted">Carregando caixa…</p> : null}

      {!aberto && eventoAberto && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div><label className="label">Troco inicial (R$)</label><CurrencyInput value={trocoInicial} onChange={setTrocoInicial} aria-label="Troco inicial do evento" /></div>
          <button type="button" className="touch-btn-primary min-h-12 sm:min-w-44" disabled={abrir.isPending || caixaQuery.isLoading} onClick={() => abrir.mutate()}>{abrir.isPending ? 'Abrindo…' : caixa ? 'Reabrir caixa' : 'Abrir caixa'}</button>
        </div>
      )}

      {!aberto && !eventoAberto && !caixa && <p className="text-sm text-ink-muted">Este evento ainda não teve caixa registrado.</p>}

      {aberto && caixa && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FORMAS.map(({ id, label }) => <div key={id} className="rounded-xl border border-line bg-surface-lighter/70 px-3 py-2"><span className="block text-xs text-ink-muted">{label}</span><strong className="mt-0.5 block tabular-nums">{formatCurrency(caixa.esperado[id] ?? 0)}</strong></div>)}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button type="button" className="touch-btn-secondary min-h-11" onClick={() => { setTipoMovimento('SUPRIMENTO'); setError(''); setDialog('movimento'); }}>＋ Suprimento</button>
            <button type="button" className="touch-btn-secondary min-h-11" onClick={() => { setTipoMovimento('SANGRIA'); setError(''); setDialog('movimento'); }}>− Sangria</button>
            <Link to={`/eventos/${eventoId}/contas-pendentes`} className={`touch-btn-secondary flex min-h-11 items-center justify-center text-center ${temPendente ? 'caixa-contas-pendentes-alerta' : ''}`} aria-label={temPendente ? 'Contas pendentes: há valores aguardando recebimento' : 'Contas pendentes'}>Contas pendentes{temPendente ? ' •' : ''}</Link>
          </div>
          <button type="button" className="touch-btn-orange min-h-12 w-full" disabled={fechar.isPending || comandasAbertas > 0} title={comandasAbertas > 0 ? 'Feche ou deixe pendentes as comandas antes de fechar o caixa.' : undefined} onClick={() => { setError(''); setContado(Object.fromEntries(FORMAS.map(({ id }) => [id, formatCurrencyInputFromNumber(caixa.esperado[id] ?? 0)]) as [Forma, string][])); setDialog('fechar'); }}>{fechar.isPending ? 'Fechando…' : comandasAbertas > 0 ? `Feche as ${comandasAbertas} comandas antes de fechar o caixa` : 'Conferir e fechar caixa'}</button>
        </>
      )}

      {caixa && !aberto && <div className="rounded-xl border border-line bg-surface-lighter/60 p-3 text-sm text-ink-muted">Último caixa encerrado em {new Date(caixa.fechadoEm ?? caixa.abertoEm).toLocaleString('pt-BR')}. O esperado em dinheiro foi {formatCurrency(caixa.esperado.DINHEIRO)}.</div>}

      <Modal open={dialog === 'movimento'} onClose={() => !registrarMovimento.isPending && setDialog(null)} title={tipoMovimento === 'SUPRIMENTO' ? 'Registrar suprimento' : 'Registrar sangria'}>
        <div className="space-y-3"><div><label className="label">Valor</label><CurrencyInput value={valorMovimento} onChange={setValorMovimento} /></div><div><label className="label">Observação (opcional)</label><input className="input" value={observacao} onChange={(event) => setObservacao(event.target.value)} maxLength={300} /></div><button className="touch-btn-primary w-full" disabled={registrarMovimento.isPending || parseCurrencyInput(valorMovimento) <= 0} onClick={() => registrarMovimento.mutate()}>Confirmar {tipoMovimento === 'SUPRIMENTO' ? 'suprimento' : 'sangria'}</button></div>
      </Modal>

      <Modal open={dialog === 'fechar'} onClose={() => !fechar.isPending && setDialog(null)} title="Conferir caixa do evento">
        <div className="space-y-3"><p className="text-sm text-ink-muted">Informe os valores contados/confirmados em cada forma de pagamento.</p>{FORMAS.map(({ id, label }) => <div key={id}><label className="label">{label} · esperado {formatCurrency(caixa?.esperado[id] ?? 0)}</label><CurrencyInput value={contado[id]} onChange={(value) => setContado((current) => ({ ...current, [id]: value }))} /></div>)}<div><label className="label">Observação (opcional)</label><textarea className="input min-h-20" value={observacaoFechamento} onChange={(event) => setObservacaoFechamento(event.target.value)} maxLength={1000} /></div><button className="touch-btn-orange w-full" disabled={fechar.isPending} onClick={() => fechar.mutate()}>Confirmar fechamento</button></div>
      </Modal>
    </section>
  );
}
