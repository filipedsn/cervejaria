import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Modal } from '../Modal';
import { CurrencyInput } from '../CurrencyInput';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../../lib/currency';
import {
  FORMAS_PAGAMENTO,
  type CaixaResposta,
  type ContaPendenteOperacao,
  type ResumoCaixa,
  defaultTurnoCardapioForm,
  buildTurnoCardapioAbrirPayload,
} from '../../lib/operacao';
import { usePollInterval } from '../../hooks/usePollInterval';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import {
  TurnoCardapioFormFields,
  type TurnoCardapioFormState,
} from './TurnoCardapioFormFields';
import { OperacaoTurnoCardapioPanel } from './OperacaoTurnoCardapioPanel';
import { invalidateOnboardingReadiness } from '../../lib/onboarding';
import { IconEye, IconEyeOff } from '../NavIcons';
import { OperacaoTurnoTapsPanel } from './OperacaoTurnoTapsPanel';
import type { Trailer } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

type Dialogo = 'nenhum' | 'movimento' | 'correcao' | 'fechar' | 'cardapio';
type OcorrenciaAgenda = {
  id: string; nome: string; data: string; status: 'PROGRAMADA' | 'ABERTA' | 'FECHADA' | 'CANCELADA';
  agenda: { nome: string; frequencia: 'SEMANAL'; diaSemana: number } | null;
};

function dataComDeslocamento(data: string, dias: number) {
  const date = new Date(`${data}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}

function dataCalendarioPt(data: string) {
  return new Date(`${data}T00:00:00.000Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function diaSemanaPt(dia: number) {
  return ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'][dia] ?? '';
}

function LinhaResumo({ rotulo, valor, destaque = false }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between py-1 ${destaque ? 'font-semibold' : ''}`}>
      <span className="text-sm text-ink-faint">{rotulo}</span>
      <span>{formatCurrency(valor)}</span>
    </div>
  );
}

function Diferenca({ valor }: { valor: number }) {
  if (valor === 0) return <span className="text-sm text-ink-faint">confere</span>;
  const positivo = valor > 0;
  return (
    <span className={`text-sm font-semibold ${positivo ? 'text-green-600' : 'text-red-600'}`}>
      {positivo ? '+' : ''}
      {formatCurrency(valor)}
    </span>
  );
}

function IconeFechamento({ tipo }: { tipo: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO' | 'OBS' }) {
  const common = { className: 'h-6 w-6 sm:h-8 sm:w-8', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  if (tipo === 'DINHEIRO') return <svg {...common}><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/></svg>;
  if (tipo === 'PIX') return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v2m-3 4h2m1-1v2"/></svg>;
  if (tipo === 'OBS') return <svg {...common}><path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8M8 16h8"/></svg>;
  return <svg {...common}><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M2.5 9h19M6.5 15h4"/></svg>;
}

interface Props {
  pontoVendaId: string;
  /** Na lista de comandas: painel compacto quando aberto. */
  compacto?: boolean;
  /** Contagem ao vivo da página de comandas; senão usa a API. */
  comandasAbertas?: number;
}

export function PainelCaixaOperacao({ pontoVendaId, compacto = false, comandasAbertas: comandasAbertasProp }: Props) {
  const queryClient = useQueryClient();
  const { canPermission } = useAuth();
  const { contexto } = useOperacaoContexto();
  const agendaCanonica = contexto.operationalSettingsSource === 'CANONICAL_PDV';
  const usaCardapio = contexto.ativo ? (contexto.usaCardapio ?? false) : false;
  const pollMs = usePollInterval(30_000);
  const [trocoInicial, setTrocoInicial] = useState(() => formatCurrencyInputFromNumber(100));
  const [dialogo, setDialogo] = useState<Dialogo>('nenhum');
  const [tipoMovimento, setTipoMovimento] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [valorMovimento, setValorMovimento] = useState('');
  const [obsMovimento, setObsMovimento] = useState('');
  const [movimentoParaCorrigir, setMovimentoParaCorrigir] = useState<ResumoCaixa['movimentos'][number] | null>(null);
  const [valorCorrigido, setValorCorrigido] = useState('');
  const [motivoCorrecao, setMotivoCorrecao] = useState('');
  const [autorizadorEmail, setAutorizadorEmail] = useState('');
  const [autorizadorSenha, setAutorizadorSenha] = useState('');
  const [historicoAberto, setHistoricoAberto] = useState<string | null>(null);
  const [contado, setContado] = useState<Record<string, string>>({});
  const [obsFechamento, setObsFechamento] = useState('');
  const [erro, setErro] = useState('');
  const [cardapioForm, setCardapioForm] = useState<TurnoCardapioFormState>(defaultTurnoCardapioForm);
  const [painelSuprimido, setPainelSuprimido] = useState(compacto);
  const [trailerId, setTrailerId] = useState('');
  const [ocorrenciaId, setOcorrenciaId] = useState('');
  const [confirmarDataDiferente, setConfirmarDataDiferente] = useState(false);

  useEffect(() => {
    if (!agendaCanonica) {
      setOcorrenciaId('');
      setConfirmarDataDiferente(false);
    }
  }, [agendaCanonica]);

  const { data: trailers = [] } = useQuery({
    queryKey: ['operacao-trailers-tap'],
    queryFn: () => api.get<Trailer[]>('/api/trailers?ativo=true'),
    enabled: contexto.tapsEnabled,
  });
  const trailerDoTurno = trailerId || (trailers.length === 1 ? trailers[0]?.id ?? '' : '');
  const precisaSelecionarTrailer = contexto.tapsEnabled && trailers.length > 1 && !trailerDoTurno;

  const { data, isLoading: caixaLoading } = useQuery({
    queryKey: ['operacao-caixa', pontoVendaId],
    queryFn: () => api.get<CaixaResposta>(`/api/operacao/caixa?pontoVendaId=${pontoVendaId}`),
    enabled: Boolean(pontoVendaId),
    refetchInterval: pollMs,
  });

  const inicioOcorrencias = data?.diaOperacional ? dataComDeslocamento(data.diaOperacional, -90) : '';
  const fimOcorrencias = data?.diaOperacional ? dataComDeslocamento(data.diaOperacional, 180) : '';
  const ocorrenciasQuery = useQuery({
    queryKey: ['operacao-agenda-ocorrencias', pontoVendaId, inicioOcorrencias, fimOcorrencias],
    queryFn: () => api.get<{ ocorrencias: OcorrenciaAgenda[] }>(`/api/operacao/agenda/ocorrencias?inicio=${inicioOcorrencias}&fim=${fimOcorrencias}`),
    enabled: Boolean(agendaCanonica && pontoVendaId && inicioOcorrencias && fimOcorrencias),
  });
  const ocorrenciasElegiveis = (ocorrenciasQuery.data?.ocorrencias ?? []).filter((o) => o.status === 'PROGRAMADA' || o.status === 'ABERTA');
  const ocorrenciaSelecionada = ocorrenciasElegiveis.find((o) => o.id === ocorrenciaId) ?? null;
  const outraData = Boolean(ocorrenciaSelecionada && data?.diaOperacional && ocorrenciaSelecionada.data !== data.diaOperacional);

  const contasPendentesQuery = useQuery({
    queryKey: ['operacao-contas-pendentes'],
    queryFn: () => api.get<ContaPendenteOperacao[]>('/api/operacao/contas-pendentes'),
    enabled: Boolean(pontoVendaId),
    refetchInterval: pollMs,
  });
  const temContaPendente = contasPendentesQuery.data?.some((conta) => conta.saldo > 0) ?? false;
  const classesContasPendentes = `touch-btn-secondary caixa-contas-pendentes-link${temContaPendente ? ' caixa-contas-pendentes-alerta' : ''}`;

  const sessao = data?.sessao ?? null;
  useEffect(() => {
    if (compacto) setPainelSuprimido(sessao?.status === 'ABERTO');
  }, [compacto, sessao?.status, sessao?.abertoEm]);

  const comandasAbertas = comandasAbertasProp ?? data?.comandasAbertas ?? 0;
  const bloqueioFechamento = comandasAbertas > 0;
  const cardapioAbrirPayload = buildTurnoCardapioAbrirPayload(cardapioForm);
  const diferencaFechamento = sessao ?
    parseCurrencyInput(contado.dinheiro ?? '') - sessao.gaveta.esperadoDinheiro
    + parseCurrencyInput(contado.pix ?? '') - sessao.esperado.pix
    + parseCurrencyInput(contado.debito ?? '') - sessao.esperado.cartaoDebito
    + parseCurrencyInput(contado.credito ?? '') - sessao.esperado.cartaoCredito
    : 0;

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['operacao-caixa', pontoVendaId] });
  };

  const abrir = useMutation({
    mutationFn: () => {
      const cardapioPayload = buildTurnoCardapioAbrirPayload(cardapioForm);
      if (!cardapioPayload) throw new Error('Escolha um cardápio antes de abrir o caixa');
      return api.post<ResumoCaixa>('/api/operacao/caixa/abrir', {
        pontoVendaId,
        trailerId: trailerDoTurno || undefined,
        ...(agendaCanonica && ocorrenciaId ? { ocorrenciaId } : {}),
        ...(agendaCanonica && outraData ? { confirmarDataDiferente } : {}),
        trocoInicial: parseCurrencyInput(trocoInicial),
        ...cardapioPayload,
      });
    },
    onSuccess: () => {
      invalidar();
      invalidateOnboardingReadiness(queryClient);
      queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
      queryClient.invalidateQueries({ queryKey: ['operacao-produtos-operacionais', pontoVendaId] });
      queryClient.invalidateQueries({ queryKey: ['operacao-turno-cardapio', pontoVendaId] });
      setCardapioForm(defaultTurnoCardapioForm());
      setOcorrenciaId('');
      setConfirmarDataDiferente(false);
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível abrir o caixa'),
  });

  const movimento = useMutation({
    mutationFn: () =>
      api.post<ResumoCaixa>('/api/operacao/caixa/movimentos', {
        pontoVendaId,
        tipo: tipoMovimento,
        valor: parseCurrencyInput(valorMovimento),
        observacao: obsMovimento.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      setDialogo('nenhum');
      setValorMovimento('');
      setObsMovimento('');
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível registrar o movimento'),
  });

  const fechar = useMutation({
    mutationFn: () =>
      api.post<ResumoCaixa>('/api/operacao/caixa/fechar', {
        pontoVendaId,
        contadoDinheiro: parseCurrencyInput(contado.dinheiro ?? '0'),
        contadoPix: parseCurrencyInput(contado.pix ?? '0'),
        contadoCartaoDebito: parseCurrencyInput(contado.debito ?? '0'),
        contadoCartaoCredito: parseCurrencyInput(contado.credito ?? '0'),
        observacaoFechamento: obsFechamento.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      queryClient.invalidateQueries({ queryKey: ['operacao-comandas'] });
      setDialogo('nenhum');
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível fechar o caixa'),
  });

  const corrigir = useMutation({
    mutationFn: () => {
      if (!movimentoParaCorrigir) throw new Error('Movimento não selecionado');
      return api.post<ResumoCaixa>(`/api/operacao/caixa/movimentos/${movimentoParaCorrigir.id}/corrigir`, {
        pontoVendaId,
        valorCorrigido: parseCurrencyInput(valorCorrigido),
        motivo: motivoCorrecao.trim(),
        autorizadorEmail: autorizadorEmail.trim(),
        autorizadorSenha,
      });
    },
    onSuccess: () => {
      invalidar();
      setDialogo('nenhum');
      setMovimentoParaCorrigir(null);
      setValorCorrigido('');
      setMotivoCorrecao('');
      setAutorizadorEmail('');
      setAutorizadorSenha('');
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível corrigir o movimento'),
  });

  const abrirDialogoFechar = () => {
    if (bloqueioFechamento) return;
    // The operator must count what's physically present; pre-filling expected
    // values can silently conceal a cash/card reconciliation discrepancy.
    setContado({ dinheiro: '', pix: '', debito: '', credito: '' });
    setObsFechamento('');
    setErro('');
    setDialogo('fechar');
  };

  if (!pontoVendaId) return null;

  const seletorTrailer = contexto.tapsEnabled && trailers.length > 0 ? (
    <div className="rounded-xl border border-line bg-surface-lighter/60 p-3">
      <label className="label">Trailer dos Taps neste turno</label>
      <select className="input" value={trailerDoTurno} onChange={(event) => setTrailerId(event.target.value)}>
        <option value="">Sem trailer de Tap</option>
        {trailers.map((trailer) => <option key={trailer.id} value={trailer.id}>{trailer.nome}{trailer.identificador ? ` (${trailer.identificador})` : ''}</option>)}
      </select>
      {precisaSelecionarTrailer && <p className="mt-2 text-sm text-amber-300">Selecione o trailer para abrir o turno com as Taps corretas.</p>}
      <p className="mt-1 text-xs text-ink-faint">A seleção define quais Taps poderão ser usados neste turno.</p>
    </div>
  ) : null;

  const seletorOcorrencia = agendaCanonica && ocorrenciasQuery.data ? (
    <div className="space-y-2 rounded-xl border border-line bg-surface-lighter/40 p-3">
      <label className="label" htmlFor="operacao-ocorrencia">Ocorrência do caixa (opcional)</label>
      <select id="operacao-ocorrencia" className="input" value={ocorrenciaId}
        onChange={(event) => { setOcorrenciaId(event.target.value); setConfirmarDataDiferente(false); }}>
        <option value="">Sem ocorrência</option>
        {ocorrenciasElegiveis.map((ocorrencia) => (
          <option key={ocorrencia.id} value={ocorrencia.id}>
            {ocorrencia.nome} · {dataCalendarioPt(ocorrencia.data)}{ocorrencia.agenda ? ` · recorrência semanal (${diaSemanaPt(ocorrencia.agenda.diaSemana)})` : ' · avulsa'}
          </option>
        ))}
      </select>
      {outraData && ocorrenciaSelecionada && data?.diaOperacional && (
        <label className="flex cursor-pointer items-start gap-2 text-sm text-amber-200">
          <input type="checkbox" className="mt-1" checked={confirmarDataDiferente}
            onChange={(event) => setConfirmarDataDiferente(event.target.checked)} />
          <span>Confirmo que estou associando “{ocorrenciaSelecionada.nome}”, de {dataCalendarioPt(ocorrenciaSelecionada.data)}, a um caixa do dia {dataCalendarioPt(data.diaOperacional)}.</span>
        </label>
      )}
    </div>
  ) : null;

  return (
    <>
      {!sessao && compacto && !caixaLoading && (
        <div className="card space-y-4 border-brand-600/30 bg-gradient-to-br from-surface via-surface to-brand-900/20 p-4 sm:space-y-5 sm:p-5">
          <header className="flex items-center gap-3 border-b border-line pb-4 sm:gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/10 text-brand-400 sm:h-16 sm:w-16"><svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9h16l1 11H3L4 9Z"/><path d="M6 9V5h12v4M8 5V3h8v2M8 13h8M10 17h4"/></svg></span>
            <div className="min-w-0"><h2 className="text-xl font-bold sm:text-2xl">Caixa do dia</h2><p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-ink-muted">Abra um turno de caixa para registrar comandas e vendas. Você pode fechar e abrir de novo no mesmo dia.</p></div>
          </header>

          {erro && <div className="alert-error">{erro}</div>}

          <div className="grid gap-3 rounded-2xl border border-line bg-surface-lighter/60 p-3 sm:grid-cols-[minmax(210px,.7fr)_minmax(0,1.5fr)] sm:items-center sm:gap-5 sm:p-4">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-500/25 bg-brand-500/10 text-brand-400"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.6-.6-1.5-.9-2.7-.9-1.5 0-2.5.7-2.5 1.8 0 2.8 5.4 1.2 5.4 4.2 0 1.2-1.1 2-2.8 2-1.1 0-2.2-.4-3-1.2M12 6v12"/></svg></span><span><strong className="block text-sm sm:text-base">Troco inicial (R$)</strong><span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">Dinheiro disponível na gaveta para iniciar o turno.</span></span></div>
            <CurrencyInput className="input min-h-12 text-base font-semibold sm:min-h-14" value={trocoInicial} onChange={setTrocoInicial} aria-label="Troco inicial em reais" />
          </div>

          <TurnoCardapioFormFields form={cardapioForm} setForm={setCardapioForm} />
          {seletorOcorrencia}
          {seletorTrailer}

          <Link to="/operacao/contas-pendentes" className={`${classesContasPendentes} flex min-h-12 w-full items-center justify-center text-center`} aria-label={temContaPendente ? 'Contas pendentes: há valores aguardando recebimento' : 'Contas pendentes'}>Contas pendentes</Link>
          {canPermission('cash.open') && <button type="button" className="touch-btn-primary flex min-h-14 w-full items-center justify-center gap-3 text-base font-bold sm:min-h-16 sm:text-lg" disabled={abrir.isPending || precisaSelecionarTrailer || !cardapioAbrirPayload || (outraData && !confirmarDataDiferente)} data-audit="operacao-caixa-abrir" data-onboarding-target="operacao-open-cash" onClick={() => abrir.mutate()}><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9h16l1 11H3L4 9Z"/><path d="M6 9V5h12v4M8 5V3h8v2M8 13h8"/></svg>{abrir.isPending ? 'Abrindo...' : 'Abrir caixa'}</button>}
        </div>
      )}

      {!sessao && !compacto && (
        <div className="card space-y-3">
          <div>
            <h2 className="text-base font-semibold">Caixa do dia</h2>
            <p className="text-sm text-ink-faint">
              Abra um turno de caixa para registrar comandas e vendas. Você pode fechar e abrir de
              novo no mesmo dia — praia de dia, rua à noite.
            </p>
          </div>

          {erro && <div className="alert-error">{erro}</div>}

          <div>
            <label className="label">Troco inicial (R$)</label>
            <CurrencyInput value={trocoInicial} onChange={setTrocoInicial} />
          </div>

          <TurnoCardapioFormFields form={cardapioForm} setForm={setCardapioForm} />
          {seletorOcorrencia}
          {seletorTrailer}

          <Link to="/operacao/contas-pendentes" className={`${classesContasPendentes} flex w-full items-center justify-center text-center`} aria-label={temContaPendente ? 'Contas pendentes: há valores aguardando recebimento' : 'Contas pendentes'}>Contas pendentes</Link>
          {canPermission('cash.open') && <button
            type="button"
            className="touch-btn-primary w-full"
            disabled={abrir.isPending || precisaSelecionarTrailer || !cardapioAbrirPayload || (outraData && !confirmarDataDiferente)}
            data-audit="operacao-caixa-abrir"
            data-onboarding-target="operacao-open-cash"
            onClick={() => abrir.mutate()}
          >
            {abrir.isPending ? 'Abrindo...' : 'Abrir caixa'}
          </button>}
        </div>
      )}

      {sessao && (
        <div className="rounded-xl border border-line bg-surface-lighter/40 px-3 py-2 text-sm" data-testid="caixa-contexto-ocorrencia">
          <span className="text-ink-faint">Ocorrência persistida: </span>
          {sessao.ocorrencia ? <strong>{sessao.ocorrencia.nome} · {dataCalendarioPt(sessao.ocorrencia.data)}{sessao.ocorrencia.agenda ? ` · semanal (${diaSemanaPt(sessao.ocorrencia.agenda.diaSemana)})` : ' · avulsa'}</strong> : <strong>Sem ocorrência</strong>}
        </div>
      )}

      {sessao?.status === 'ABERTO' && data?.valoresRestritos && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold">Caixa aberto</h2><p className="text-sm text-ink-muted">Os valores financeiros estão restritos à sua permissão.</p></div>
          <div className="flex flex-wrap gap-2">
            {canPermission('cash.movement.write') && <>
              {canPermission('cash.movement.write') && <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => { setTipoMovimento('SUPRIMENTO'); setErro(''); setDialogo('movimento'); }}>Suprimento</button>}
              {canPermission('cash.movement.write') && <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => { setTipoMovimento('SANGRIA'); setErro(''); setDialogo('movimento'); }}>Sangria</button>}
            </>}
            {canPermission('cash.close') && canPermission('cash.values.read') && <button type="button" className="touch-btn-orange" disabled={bloqueioFechamento} onClick={abrirDialogoFechar}>Fechar caixa</button>}
          </div>
        </div>
      )}

      {sessao?.status === 'ABERTO' && !data?.valoresRestritos && compacto && painelSuprimido && (
        <div className="card flex min-h-14 items-center justify-between gap-3 border-brand-600/30 bg-gradient-to-br from-surface via-surface to-brand-900/20 px-4 py-2">
          <span className="text-sm font-semibold text-ink">Caixa aberto <span className="font-normal text-ink-muted">· Em operação</span></span>
          <button
            type="button"
            className="icon-btn-ghost"
            aria-label="Mostrar painel do caixa"
            title="Mostrar painel do caixa"
            onClick={() => setPainelSuprimido(false)}
          >
            <IconEye className="h-5 w-5" />
          </button>
        </div>
      )}

      {sessao?.status === 'ABERTO' && compacto && !data?.valoresRestritos && !painelSuprimido && (
        <div className="card grid gap-5 border-brand-600/30 bg-gradient-to-br from-surface via-surface to-brand-900/20 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,1.2fr)] lg:items-center lg:gap-7">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="text-xl font-bold">Caixa aberto</h2><p className="mt-0.5 text-sm text-ink-muted">Seu caixa está em operação.</p></div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs font-semibold text-green-500"><span className="h-2 w-2 rounded-full bg-green-500" />Em operação</span>
                <button
                  type="button"
                  className="icon-btn-ghost"
                  aria-label="Suprimir painel do caixa"
                  title="Suprimir painel do caixa"
                  onClick={() => setPainelSuprimido(true)}
                >
                  <IconEyeOff className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-line bg-surface-lighter/70 px-3 py-2.5"><p className="text-xs text-ink-muted">Gaveta</p><strong className="mt-0.5 block text-lg font-bold tabular-nums">{formatCurrency(sessao.gaveta.esperadoDinheiro)}</strong></div>
              <div className="rounded-xl border border-line bg-surface-lighter/70 px-3 py-2.5"><p className="text-xs text-ink-muted">Recebido</p><strong className="mt-0.5 block text-lg font-bold tabular-nums">{formatCurrency(sessao.esperado.totalVendas)}</strong></div>
            </div>
          </div>

          <div className="space-y-2.5 lg:border-l lg:border-line lg:pl-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {canPermission('cash.movement.write') && <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => { setTipoMovimento('SUPRIMENTO'); setErro(''); setDialogo('movimento'); }}>Suprimento</button>}
              {canPermission('cash.movement.write') && <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => { setTipoMovimento('SANGRIA'); setErro(''); setDialogo('movimento'); }}>Sangria</button>}
              {usaCardapio && <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => { setErro(''); setDialogo('cardapio'); }}>Cardápio do turno</button>}
              <Link to="/operacao/contas-pendentes" className={`${classesContasPendentes} touch-btn-sm flex items-center justify-center text-center leading-tight`} aria-label={temContaPendente ? 'Contas pendentes: há valores aguardando recebimento' : 'Contas pendentes'}>Contas pendentes</Link>
            </div>
            {erro && !dialogo && <div className="alert-error">{erro}</div>}
            {canPermission('cash.close') && canPermission('cash.values.read') && <button type="button" className="touch-btn-orange w-full disabled:opacity-50" disabled={bloqueioFechamento} onClick={abrirDialogoFechar} data-audit="operacao-caixa-fechar">Fechar caixa</button>}
          </div>
        </div>
      )}

      {sessao?.status === 'ABERTO' && !compacto && !data?.valoresRestritos && (
        <>
          {sessao.trailerId && <OperacaoTurnoTapsPanel pontoVendaId={pontoVendaId} />}
          {usaCardapio && (
            <div className="card space-y-3">
              <OperacaoTurnoCardapioPanel pontoVendaId={pontoVendaId} embedded />
            </div>
          )}

          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Caixa aberto</h2>
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                Em operação
              </span>
            </div>

            <LinhaResumo rotulo="Troco inicial" valor={sessao.gaveta.trocoInicial} />
            <LinhaResumo rotulo="Recebimentos em dinheiro" valor={sessao.gaveta.entradasDinheiro} />
            <LinhaResumo rotulo="Suprimentos" valor={sessao.gaveta.suprimentos} />
            <LinhaResumo rotulo="Sangrias" valor={-sessao.gaveta.sangrias} />
            <div className="border-t border-ink/10 pt-2">
              <LinhaResumo rotulo="Dinheiro esperado na gaveta" valor={sessao.gaveta.esperadoDinheiro} destaque />
            </div>
          </div>

          <div className="card space-y-2">
            <h3 className="font-semibold">Recebimentos por forma</h3>
            {FORMAS_PAGAMENTO.map((forma) => {
              const chave =
                forma.valor === 'DINHEIRO'
                  ? 'dinheiro'
                  : forma.valor === 'PIX'
                    ? 'pix'
                    : forma.valor === 'CARTAO_DEBITO'
                      ? 'cartaoDebito'
                      : 'cartaoCredito';
              const valor = sessao.esperado[chave as keyof typeof sessao.esperado] as number;
              return <LinhaResumo key={forma.valor} rotulo={forma.label} valor={valor} />;
            })}
            <div className="border-t border-ink/10 pt-2">
              <LinhaResumo rotulo="Total recebido" valor={sessao.esperado.totalVendas} destaque />
            </div>
          </div>

          {sessao.movimentos.length > 0 && (
            <div className="card space-y-2">
              <h3 className="font-semibold">Movimentos</h3>
              {sessao.movimentos.filter((mov) => !mov.correcaoDeId).map((mov) => (
                <div key={mov.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {mov.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}
                    {mov.corrigidoEm && <span className="ml-2 text-xs font-semibold text-amber-700">CORRIGIDA</span>}
                    {mov.observacao ? ` — ${mov.observacao}` : ''}
                  </span>
                  <span className={mov.tipo === 'SANGRIA' ? 'text-red-600' : 'text-green-600'}>
                    {mov.tipo === 'SANGRIA' ? '-' : '+'}
                    {formatCurrency(sessao.movimentos.find((item) => item.correcaoDeId === mov.id && item.naturezaCorrecao === 'SUBSTITUICAO')?.valor ?? mov.valor)}
                  </span>
                  {!mov.corrigidoEm && (
                    <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => {
                      setMovimentoParaCorrigir(mov);
                      setValorCorrigido(formatCurrencyInputFromNumber(mov.valor));
                      setMotivoCorrecao(''); setAutorizadorEmail(''); setAutorizadorSenha(''); setErro(''); setDialogo('correcao');
                    }}>Corrigir</button>
                  )}
                  {mov.corrigidoEm && (
                    <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => setHistoricoAberto(historicoAberto === mov.id ? null : mov.id)}>Ver histórico</button>
                  )}
                  {historicoAberto === mov.id && <div className="mt-2 rounded bg-ink/5 p-2 text-xs text-ink-faint">
                    <div>Original: {formatCurrency(mov.valor)}</div>
                    <div>Estorno: {formatCurrency(sessao.movimentos.find((item) => item.correcaoDeId === mov.id && item.naturezaCorrecao === 'ESTORNO')?.valor ?? 0)}</div>
                    <div>Novo valor: {formatCurrency(sessao.movimentos.find((item) => item.correcaoDeId === mov.id && item.naturezaCorrecao === 'SUBSTITUICAO')?.valor ?? mov.valor)}</div>
                    <div>Motivo: {mov.motivoCorrecao}</div>
                    <div>Autorizado por: {mov.autorizadoPorId}</div>
                  </div>}
                </div>
              ))}
            </div>
          )}

          {canPermission('cash.movement.write') && <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="touch-btn-secondary"
              onClick={() => {
                setTipoMovimento('SUPRIMENTO');
                setErro('');
                setDialogo('movimento');
              }}
            >
              Suprimento
            </button>
            <button
              type="button"
              className="touch-btn-secondary"
              onClick={() => {
                setTipoMovimento('SANGRIA');
                setErro('');
                setDialogo('movimento');
              }}
            >
              Sangria
            </button>
          </div>}

          {erro && !dialogo && <div className="alert-error">{erro}</div>}

          {canPermission('cash.close') && canPermission('cash.values.read') && <button
            type="button"
            className="touch-btn-orange w-full disabled:opacity-50"
            disabled={bloqueioFechamento}
            onClick={abrirDialogoFechar}
            data-audit="operacao-caixa-fechar"
          >
            Fechar caixa
          </button>}
        </>
      )}

      {sessao?.status === 'FECHADO' && !data?.valoresRestritos && (
        <div className="card space-y-3">
          <div>
            <h2 className="text-base font-semibold">Turno encerrado</h2>
            <p className="text-sm text-ink-faint">
              Conferência do turno que acabou de fechar. Abra um novo turno abaixo quando for
              operar de novo.
            </p>
          </div>
          {!compacto && (
            <div className="space-y-2">
              <h3 className="font-semibold">Conferência</h3>
              {FORMAS_PAGAMENTO.map((forma) => {
                const esperadoChave =
                  forma.valor === 'DINHEIRO'
                    ? 'dinheiro'
                    : forma.valor === 'PIX'
                      ? 'pix'
                      : forma.valor === 'CARTAO_DEBITO'
                        ? 'cartaoDebito'
                        : 'cartaoCredito';
                const contadoChave =
                  forma.valor === 'DINHEIRO'
                    ? 'dinheiro'
                    : forma.valor === 'PIX'
                      ? 'pix'
                      : forma.valor === 'CARTAO_DEBITO'
                        ? 'cartaoDebito'
                        : 'cartaoCredito';
                const esperado =
                  forma.valor === 'DINHEIRO'
                    ? sessao.gaveta.esperadoDinheiro
                    : (sessao.esperado[esperadoChave as keyof typeof sessao.esperado] as number);
                const contadoValor = sessao.contado?.[contadoChave as keyof NonNullable<typeof sessao.contado>] ?? 0;
                const diff = sessao.diferencas?.[contadoChave as keyof NonNullable<typeof sessao.diferencas>] ?? 0;

                return (
                  <div key={forma.valor} className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{forma.label}</span>
                    <div className="text-right">
                      <div>
                        {formatCurrency(contadoValor)}{' '}
                        <span className="text-ink-faint">/ {formatCurrency(esperado)}</span>
                      </div>
                      <Diferenca valor={diff} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {sessao.observacaoFechamento && (
            <p className="text-sm text-ink-faint">Obs.: {sessao.observacaoFechamento}</p>
          )}
        </div>
      )}

      {usaCardapio && (
        <Modal
          open={dialogo === 'cardapio'}
          onClose={() => setDialogo('nenhum')}
          title="Cardápio do turno"
          hideHeaderClose
        >
          <OperacaoTurnoCardapioPanel
            pontoVendaId={pontoVendaId}
            embedded
            onClose={() => setDialogo('nenhum')}
          />
        </Modal>
      )}

      <Modal
        open={dialogo === 'movimento'}
        onClose={() => setDialogo('nenhum')}
        title={tipoMovimento === 'SANGRIA' ? 'Registrar sangria' : 'Registrar suprimento'}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valorMovimento.trim() || parseCurrencyInput(valorMovimento) <= 0) {
              return setErro('Informe um valor válido');
            }
            movimento.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <div>
            <label className="label">Valor (R$)</label>
            <CurrencyInput autoFocus value={valorMovimento} onChange={setValorMovimento} />
          </div>
          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={obsMovimento} onChange={(e) => setObsMovimento(e.target.value)} />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={movimento.isPending} data-audit={tipoMovimento === 'SANGRIA' ? 'operacao-caixa-sangria' : 'operacao-caixa-suprimento'}>
            {movimento.isPending ? 'Salvando...' : 'Confirmar'}
          </button>
        </form>
      </Modal>

      <Modal open={dialogo === 'correcao'} onClose={() => !corrigir.isPending && setDialogo('nenhum')} title="Corrigir movimentação">
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (!valorCorrigido.trim() || parseCurrencyInput(valorCorrigido) <= 0) return setErro('Informe o novo valor');
          if (!motivoCorrecao.trim()) return setErro('Informe o motivo da correção');
          corrigir.mutate();
        }}>
          {erro && <div className="alert-error">{erro}</div>}
          <p className="text-sm text-ink-faint">Valor atual: {movimentoParaCorrigir && formatCurrency(movimentoParaCorrigir.valor)}</p>
          <div><label className="label">Novo valor (R$)</label><CurrencyInput autoFocus value={valorCorrigido} onChange={setValorCorrigido} /></div>
          <div><label className="label">Motivo</label><input className="input" value={motivoCorrecao} onChange={(e) => setMotivoCorrecao(e.target.value)} maxLength={500} /></div>
          <fieldset className="space-y-3 border-t border-ink/10 pt-3"><legend className="text-sm font-semibold">Autorização do responsável</legend>
            <div><label className="label">E-mail do DONO</label><input className="input" type="email" autoComplete="username" value={autorizadorEmail} onChange={(e) => setAutorizadorEmail(e.target.value)} /></div>
            <div><label className="label">Senha</label><input className="input" type="password" autoComplete="current-password" value={autorizadorSenha} onChange={(e) => setAutorizadorSenha(e.target.value)} /></div>
          </fieldset>
          <button type="submit" className="touch-btn-primary w-full" disabled={corrigir.isPending} data-audit="operacao-caixa-corrigir">{corrigir.isPending ? 'Corrigindo...' : 'Autorizar e corrigir'}</button>
        </form>
      </Modal>

      <Modal
        open={dialogo === 'fechar'}
        extraWide
        hideHeader
        onClose={() => {
          if (fechar.isPending) return;
          setDialogo('nenhum');
          setErro('');
        }}
        title="Fechar caixa"
        hideHeaderClose
        footer={
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            <button
              type="button"
              className="touch-btn-secondary w-full min-h-[4.5rem] border-brand-500/25 bg-surface-lighter text-xl sm:min-h-[5.75rem] sm:text-2xl"
              disabled={fechar.isPending}
              onClick={() => {
                setDialogo('nenhum');
                setErro('');
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="fechar-caixa-form"
              className="touch-btn-orange w-full min-h-[4.5rem] text-xl sm:min-h-[5.75rem] sm:text-2xl"
              disabled={fechar.isPending}
              data-audit="operacao-caixa-fechar-confirmar"
            >
              {fechar.isPending ? 'Fechando...' : 'Confirmar fechamento'}
            </button>
          </div>
        }
      >
        <form
          id="fechar-caixa-form"
          className="space-y-7 py-4 sm:space-y-9 sm:py-6"
          onSubmit={(e) => {
            e.preventDefault();
            fechar.mutate();
          }}
        >
          <header className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(300px,.52fr)] sm:items-center sm:gap-8">
            <div><h2 id="modal-title" className="text-3xl font-bold sm:text-5xl">Fechar caixa</h2><p className="mt-3 max-w-3xl text-base leading-relaxed text-ink-muted sm:text-2xl">Conte o que há fisicamente e ajuste se necessário.<br className="hidden xl:block" /> A diferença aparece no resumo.</p></div>
            <div className="flex min-h-24 items-center gap-4 rounded-3xl border border-brand-500/30 bg-surface-lighter/40 p-4 sm:min-h-36 sm:gap-5 sm:p-6">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-400 sm:h-20 sm:w-20"><svg viewBox="0 0 24 24" className="h-8 w-8 sm:h-10 sm:w-10" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 12 16 8M12 12v5"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg></span>
              <span className="min-w-0"><span className="block text-base text-ink-muted sm:text-2xl">Diferença</span><strong className="mt-1 block whitespace-nowrap text-xl font-bold tabular-nums text-brand-400 sm:text-3xl">{formatCurrency(diferencaFechamento)}</strong></span>
              <span className="ml-auto text-3xl text-brand-400" aria-hidden="true">›</span>
            </div>
          </header>
          {erro && <div className="alert-error">{erro}</div>}
          <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-7">
            {FORMAS_PAGAMENTO.map((forma) => {
              const chave = forma.valor === 'DINHEIRO' ? 'dinheiro' : forma.valor === 'PIX' ? 'pix' : forma.valor === 'CARTAO_DEBITO' ? 'debito' : 'credito';
              const esperado = forma.valor === 'DINHEIRO'
                ? sessao?.gaveta.esperadoDinheiro ?? 0
                : forma.valor === 'PIX'
                  ? sessao?.esperado.pix ?? 0
                  : forma.valor === 'CARTAO_DEBITO'
                    ? sessao?.esperado.cartaoDebito ?? 0
                    : sessao?.esperado.cartaoCredito ?? 0;
              const valorConferido = parseCurrencyInput(contado[chave] ?? '');
              const diferenca = valorConferido - esperado;
              const rotulo = forma.valor === 'DINHEIRO' ? 'Contado' : 'Conferido';
              const rotuloEsperado = forma.valor === 'DINHEIRO' ? 'Esperado na gaveta' : 'Esperado neste caixa';
              return (
                <div key={forma.valor}>
                  <label className="mb-2 block text-lg font-semibold text-ink sm:text-2xl">{rotulo} — {forma.label}</label>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 text-sm">
                    <span className="text-ink-muted">{rotuloEsperado}: <strong className="text-ink">{formatCurrency(esperado)}</strong></span>
                    <span className={diferenca === 0 ? 'text-ink-muted' : diferenca > 0 ? 'font-semibold text-green-500' : 'font-semibold text-red-500'}>
                      Diferença: {diferenca > 0 ? '+' : ''}{formatCurrency(diferenca)}
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex w-16 items-center justify-center border-r border-line text-brand-300 sm:w-24"><IconeFechamento tipo={forma.valor} /></span>
                    <CurrencyInput aria-label={`${rotulo} — ${forma.label}`} className="input min-h-16 text-lg sm:min-h-24 sm:text-3xl" style={{ paddingLeft: '6.25rem' }} value={contado[chave] ?? ''} onChange={(valor) => setContado((atual) => ({ ...atual, [chave]: valor }))} />
                  </div>
                </div>
              );
            })}
            <div className="sm:col-span-2 flex items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-4">
              <div>
                <p className="font-semibold text-ink">Pendente do turno</p>
                <p className="mt-1 text-sm text-ink-muted">Contas ainda não recebidas; não entram na conferência dos valores pagos.</p>
              </div>
              <strong className="shrink-0 text-xl font-bold tabular-nums text-amber-400">{formatCurrency(sessao?.pendente ?? 0)}</strong>
            </div>
            <div className="sm:col-span-2"><label className="mb-3 block text-lg font-semibold text-ink sm:text-2xl">Observação (opcional)</label><div className="relative"><span className="absolute inset-y-0 left-0 flex w-16 items-center justify-center border-r border-line text-ink-muted sm:w-24"><IconeFechamento tipo="OBS" /></span><input className="input min-h-16 text-lg sm:min-h-24 sm:text-2xl" style={{ paddingLeft: '6.25rem' }} value={obsFechamento} onChange={(e) => setObsFechamento(e.target.value)} placeholder="Adicione uma observação, se necessário..." /></div></div>
          </div>
        </form>
      </Modal>
    </>
  );
}
