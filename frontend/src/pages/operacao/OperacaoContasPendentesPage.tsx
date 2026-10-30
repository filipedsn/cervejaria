import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import {
  PaymentFormModal,
  createDefaultPaymentForm,
  toPaymentForma,
  type PaymentFormRow,
} from '../../components/PaymentFormModal';
import { parseCurrencyInput } from '../../lib/currency';
import { formatPhone } from '../../lib/phone';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { usePollInterval } from '../../hooks/usePollInterval';
import { useAuth } from '../../contexts/AuthContext';
import type { CaixaResposta, ContaPendenteOperacao } from '../../lib/operacao';
import { contaPendenteCorrespondeBusca } from '../../lib/contas-pendentes-busca';
import { agruparContasPorCliente, dataConsumoConta, type GrupoContasCliente } from '../../lib/contas-pendentes-grupo';
import { montarMensagemCobrancaContas } from '../../lib/contas-pendentes-cobranca';
import type { Cervejaria } from '../../types';

type FiltroConta = 'TODAS' | 'HOJE' | 'ATRASADAS' | 'MAIOR_VALOR';

function rotuloConta(conta: ContaPendenteOperacao) {
  const tipo = conta.comanda.tipo;
  if (tipo === 'AVULSA') return 'Venda avulsa';
  const prefixo = tipo === 'MESA' ? 'Mesa ' : tipo === 'FICHA' ? 'Ficha ' : '';
  return prefixo + (conta.comanda.identificador ?? 'Comanda');
}

function dataLocal(valor: string | Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(valor));
}

function diasEmAbertoDesde(createdAt: string) {
  const inicio = new Date(dataLocal(createdAt) + 'T00:00:00-03:00').getTime();
  const hoje = new Date(dataLocal(new Date()) + 'T00:00:00-03:00').getTime();
  return Math.max(0, Math.floor((hoje - inicio) / 86_400_000));
}

function dataTurnoLabel(conta: ContaPendenteOperacao) {
  return new Date(dataConsumoConta(conta)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function Icon({ nome, className = 'h-5 w-5' }: { nome: 'pessoa' | 'moeda' | 'tendencia' | 'busca' | 'calendario' | 'relogio' | 'ordenar' | 'itens' | 'olho' | 'enviar' | 'whatsapp' | 'cartao'; className?: string }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  switch (nome) {
    case 'pessoa': return <svg {...common}><circle cx="9" cy="8" r="3.2" fill="currentColor" stroke="none"/><circle cx="17" cy="9" r="2.6" fill="currentColor" stroke="none"/><path d="M2.5 19a6.5 6.5 0 0 1 13 0v1h-13v-1ZM15 14a5.2 5.2 0 0 1 6.5 5v1H17v-1a8 8 0 0 0-2-5Z" fill="currentColor" stroke="none"/></svg>;
    case 'moeda': return <svg {...common}><path d="M12 2.8c-4.2 0-7.2 1-7.2 2.4v3.1c0 1.4 3 2.4 7.2 2.4s7.2-1 7.2-2.4V5.2c0-1.4-3-2.4-7.2-2.4Zm0 9.2c-4.2 0-7.2-1-7.2-2.4v3.1c0 1.4 3 2.4 7.2 2.4s7.2-1 7.2-2.4V9.6c0 1.4-3 2.4-7.2 2.4Zm0 5.5c-4.2 0-7.2-1-7.2-2.4v3.1c0 1.4 3 2.4 7.2 2.4s7.2-1 7.2-2.4v-3.1c0 1.4-3 2.4-7.2 2.4Z" fill="currentColor" stroke="none"/></svg>;
    case 'tendencia': return <svg {...common}><path d="m3 16 6-6 4 4 8-9"/><path d="M15 5h6v6"/></svg>;
    case 'busca': return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>;
    case 'calendario': return <svg {...common}><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4M16.5 3v4M3.5 9.5h17"/></svg>;
    case 'relogio': return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>;
    case 'ordenar': return <svg {...common}><path d="M7 4v16M4 7l3-3 3 3M17 20V4m-3 13 3 3 3-3"/></svg>;
    case 'itens': return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16"/></svg>;
    case 'olho': return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
    case 'enviar': return <svg {...common}><path d="m21 3-7.5 18-3.8-7.7L2 9.5 21 3Z"/><path d="M9.7 13.3 21 3"/></svg>;
    case 'whatsapp': return <svg {...common}><path d="M20.2 11.8a8.2 8.2 0 0 1-12.1 7.1L3 20l1.2-4.8a8.2 8.2 0 1 1 16-3.4Z"/><path d="M8.2 7.8c.2-.5.5-.5.8-.5h.5c.2 0 .4.1.5.4l.8 1.8c.1.2.1.4-.1.6l-.6.7c-.2.2-.2.4-.1.6.6 1.1 1.5 2 2.7 2.6.2.1.4.1.6-.1l.8-1c.2-.2.4-.3.7-.2l1.7.8c.3.1.4.3.4.5 0 .4-.2 1.2-.8 1.7-.6.6-1.4.8-2.1.7-1.1-.2-2.4-.7-3.9-2-1.2-1.1-2.1-2.4-2.4-3.5-.3-1.1 0-2.1.5-2.6Z"/></svg>;
    case 'cartao': return <svg {...common}><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M2.5 9h19M6.5 15h4"/></svg>;
  }
}

export function OperacaoContasPendentesPage() {
  const queryClient = useQueryClient();
  const { cervejaria, canPermission } = useAuth();
  const podeReceberConta = canPermission('debt.receive');
  const { contexto } = useOperacaoContexto();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];
  const [pontoVendaId, setPontoVendaId] = useState('');
  const [contaSelecionada, setContaSelecionada] = useState<ContaPendenteOperacao | null>(null);
  const [contaItensAbertos, setContaItensAbertos] = useState<ContaPendenteOperacao | null>(null);
  const [grupoExpandidoId, setGrupoExpandidoId] = useState<string | null | undefined>(undefined);
  const [turnoReceberId, setTurnoReceberId] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroConta>('TODAS');
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([]);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const pollMs = usePollInterval(30_000);
  const perfilCobrancaQuery = useQuery({
    queryKey: ['perfil-cobranca-pix', cervejaria?.id],
    queryFn: () => api.get<{ cervejaria: Cervejaria | null }>('/api/auth/me'),
    initialData: cervejaria ? { cervejaria } : undefined,
    staleTime: 0,
  });
  const perfilCobranca = perfilCobrancaQuery.data?.cervejaria ?? cervejaria;
  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';
  const contasQuery = useQuery({
    queryKey: ['operacao-contas-pendentes'],
    queryFn: () => api.get<ContaPendenteOperacao[]>('/api/operacao/contas-pendentes'),
    refetchInterval: pollMs,
  });
  const resumoQuery = useQuery({
    queryKey: ['operacao-contas-pendentes-resumo'],
    queryFn: () => api.get<{ recebimentosHoje: number }>('/api/operacao/contas-pendentes/resumo'),
    refetchInterval: pollMs,
  });
  const caixaQuery = useQuery({
    queryKey: ['operacao-caixa', pontoAtivo],
    queryFn: () => api.get<CaixaResposta>('/api/operacao/caixa?pontoVendaId=' + pontoAtivo),
    enabled: Boolean(pontoAtivo),
    refetchInterval: pollMs,
  });
  const caixaAberto = caixaQuery.data?.sessao?.status === 'ABERTO';
  const contas = contasQuery.data ?? [];
  const recebimentosHoje = resumoQuery.data?.recebimentosHoje ?? 0;
  const valorPendente = contas.reduce((total, conta) => total + conta.saldo, 0);
  const clientesPendentes = new Set(contas.map((conta) => conta.cliente.id)).size;
  const gruposVisiveis = useMemo(() => {
    const filtradas = contas.filter((conta) => {
      if (!contaPendenteCorrespondeBusca(conta, busca)) return false;
      const dataConsumo = dataLocal(dataConsumoConta(conta));
      if (filtro === 'HOJE') return dataConsumo === dataLocal(new Date());
      if (filtro === 'ATRASADAS') return diasEmAbertoDesde(conta.createdAt) >= 3;
      return true;
    });
    const grupos = agruparContasPorCliente(filtradas);
    return filtro === 'MAIOR_VALOR'
      ? [...grupos].sort((a, b) => b.saldo - a.saldo)
      : grupos;
  }, [busca, contas, filtro]);
  const grupoExpandido = gruposVisiveis.find((grupo) => grupo.clienteId === grupoExpandidoId)
    ?? (grupoExpandidoId === undefined ? gruposVisiveis[0] : undefined);

  const receber = useMutation({
    mutationFn: () => {
      if (!contaSelecionada || !pontoAtivo) throw new Error('Selecione uma conta e um ponto de venda');
      const pagamentos = paymentForm.map((row) => ({ forma: toPaymentForma(row), valor: parseCurrencyInput(row.valor) }));
      return api.post<ContaPendenteOperacao>('/api/operacao/contas-pendentes/' + contaSelecionada.id + '/pagamentos', { pontoVendaId: pontoAtivo, pagamentos });
    },
    onSuccess: (conta) => {
      const valorRecebido = paymentForm.reduce((soma, row) => soma + parseCurrencyInput(row.valor), 0);
      setMensagem(conta.saldo === 0
        ? 'Conta de ' + conta.cliente.nome + ' quitada · ' + formatCurrency(valorRecebido) + ' recebido.'
        : 'Recebimento de ' + formatCurrency(valorRecebido) + ' registrado · saldo restante ' + formatCurrency(conta.saldo) + '.');
      setContaSelecionada(null);
      queryClient.invalidateQueries({ queryKey: ['operacao-contas-pendentes'] });
      queryClient.invalidateQueries({ queryKey: ['operacao-contas-pendentes-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['operacao-caixa'] });
      queryClient.invalidateQueries({ queryKey: ['operacao-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cervejaria-dashboard'] });
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível registrar o recebimento.'),
  });

  const abrirRecebimento = (conta: ContaPendenteOperacao) => {
    setContaSelecionada(conta);
    setPaymentForm(createDefaultPaymentForm(conta.saldo));
    setErro('');
    setMensagem('');
  };

  const contaParaReceber = (grupo: GrupoContasCliente) => {
    if (grupo.contas.length === 1) return grupo.contas[0];
    const escolhida = turnoReceberId[grupo.clienteId];
    return grupo.contas.find((conta) => conta.id === escolhida) ?? null;
  };

  const enviarCobranca = (grupo: GrupoContasCliente) => {
    const telefone = (grupo.cliente.telefone ?? '').replace(/\D/g, '');
    if (!telefone) return;
    const telefoneComPais = telefone.startsWith('55') ? telefone : '55' + telefone;
    const texto = montarMensagemCobrancaContas(grupo.contas, perfilCobranca);
    window.open('https://wa.me/' + telefoneComPais + '?text=' + encodeURIComponent(texto), '_blank', 'noopener,noreferrer');
  };

  if (contasQuery.isLoading) return <Loading />;

  return (
    <div className="space-y-5 pb-6">
      <header>
        <h1 className="page-title">Contas pendentes</h1>
        <p className="page-subtitle">Saldos consolidados por cliente, com detalhe por turno.</p>
      </header>
      {pontosVenda.length > 1 && (
        <label className="block max-w-sm">
          <span className="label">Registrar recebimentos no caixa de</span>
          <select className="input" value={pontoAtivo} onChange={(event) => setPontoVendaId(event.target.value)}>
            {pontosVenda.map((ponto) => <option key={ponto.id} value={ponto.id}>{ponto.nome}</option>)}
          </select>
        </label>
      )}
      {caixaQuery.isError && <div role="alert" className="alert-error">Nao foi possivel consultar o caixa. O recebimento pode estar vinculado a um turno ativo; tente novamente antes de concluir.</div>}
      {caixaQuery.isFetched && !caixaQuery.isError && !caixaAberto && (
        <div className="flex items-center gap-3 rounded-xl border border-orange/40 bg-orange/10 px-4 py-3 text-sm font-medium text-orange-dark">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange/10 text-lg" aria-hidden="true">!</span>
          <span>Caixa fechado: o recebimento será registrado como <strong>Pendurado</strong> e não entrará no fechamento do turno.</span>
        </div>
      )}
      {mensagem && <div className="alert-success">{mensagem}</div>}
      {erro && <div className="alert-error">{erro}</div>}
      {contasQuery.error && <div className="alert-error">Não foi possível carregar as contas pendentes.</div>}

      {contas.length > 0 && (
        <>
          <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Resumo das contas pendentes">
            <ResumoCard icon="pessoa" label="Clientes pendentes" value={String(clientesPendentes)} detail="Comandas encerradas sem pagamento" tone="blue" />
            <ResumoCard icon="moeda" label="Valor pendente" value={formatCurrency(valorPendente)} detail="Total a receber" tone="orange" />
            <ResumoCard icon="tendencia" label="Recebimentos hoje" value={formatCurrency(recebimentosHoje)} detail="Já recebidos no dia" tone="green" />
          </section>
          <section className="flex flex-col gap-3 lg:flex-row lg:items-center" aria-label="Buscar e filtrar contas">
            <label className="relative min-w-0 flex-1">
              <Icon nome="busca" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" />
              <input
                className="input pl-12"
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar cliente, telefone ou comanda..."
                data-testid="contas-pendentes-busca"
                aria-label="Buscar contas pendentes"
              />
            </label>
            <div className="flex gap-2 overflow-x-auto pb-1 xl:pb-0">
              <FiltroButton active={filtro === 'TODAS'} onClick={() => setFiltro('TODAS')}>Todas</FiltroButton>
              <FiltroButton active={filtro === 'HOJE'} icon="calendario" onClick={() => setFiltro('HOJE')}>Hoje</FiltroButton>
              <FiltroButton active={filtro === 'ATRASADAS'} icon="relogio" onClick={() => setFiltro('ATRASADAS')}>Atrasadas</FiltroButton>
              <FiltroButton active={filtro === 'MAIOR_VALOR'} icon="ordenar" onClick={() => setFiltro('MAIOR_VALOR')}>Maior valor</FiltroButton>
            </div>
          </section>
          {gruposVisiveis.length === 0 ? (
            <EmptyState icon="⌕" title="Nenhuma conta encontrada" description="Tente mudar a busca ou o filtro selecionado." />
          ) : (
            <section className="space-y-3" aria-label="Lista de contas pendentes">
              {gruposVisiveis.map((grupo) => {
                const expanded = grupoExpandido?.clienteId === grupo.clienteId;
                const dias = diasEmAbertoDesde(grupo.createdAtMaisAntigo);
                const turnoSelecionado = contaParaReceber(grupo);
                const previewItens = grupo.contas.flatMap((conta) => conta.comanda.itens).slice(0, 3);
                const totalItens = grupo.contas.reduce((soma, conta) => soma + conta.comanda.itens.length, 0);
                return (
                  <article key={grupo.clienteId} className={'overflow-hidden rounded-2xl border bg-surface shadow-sm transition-colors ' + (expanded ? 'border-line' : 'border-line/80 hover:border-brand-600/50')}>
                    <div className={expanded ? 'p-4 sm:p-5' : 'p-3 sm:px-5 sm:py-3'}>
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                        <button type="button" className="flex min-w-0 items-start gap-3 text-left" aria-expanded={expanded} onClick={() => setGrupoExpandidoId(expanded ? null : grupo.clienteId)}>
                          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600/15 text-brand-600 sm:flex"><Icon nome="pessoa" className="h-6 w-6" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2 sm:gap-3">
                              <strong className="truncate text-base font-bold text-ink sm:text-lg">{grupo.cliente.nome}</strong>
                              <StatusPill>◷&nbsp; Pendente</StatusPill>
                              {grupo.contas.length > 1 && <StatusPill>{grupo.contas.length} turnos</StatusPill>}
                              {dias >= 3 && <StatusPill overdue>◷&nbsp; {dias} dias em aberto</StatusPill>}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
                              <span>{formatPhone(grupo.cliente.telefone ?? '')}</span>
                              <span className="hidden sm:inline">·</span>
                              <span>{grupo.contas.length === 1 ? `Consumo em ${dataTurnoLabel(grupo.contas[0])}` : `${grupo.contas.length} turnos · desde ${dataTurnoLabel(grupo.contas[0])}`}</span>
                            </span>
                            {!expanded && (
                              <span className="mt-2 flex flex-wrap gap-1.5">
                                {previewItens.map((item, index) => <span key={grupo.clienteId + '-' + index} className="rounded-full border border-line bg-surface-lighter px-2.5 py-1 text-xs text-ink-soft">{item.quantidade}× {item.nome ?? 'Item'}</span>)}
                                {totalItens > 3 && <span className="rounded-full border border-line bg-surface-lighter px-2.5 py-1 text-xs text-ink-muted">+ {totalItens - 3} itens</span>}
                              </span>
                            )}
                          </span>
                        </button>
                        <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
                          <span className="text-xs text-ink-muted lg:text-right">Valor pendente<strong className="mt-0.5 block text-xl font-bold tabular-nums text-orange-dark sm:text-2xl">{formatCurrency(grupo.saldo)}</strong></span>
                          {!expanded && <button type="button" className="icon-btn-ghost text-ink-muted" aria-label={'Ver detalhes de ' + grupo.cliente.nome} onClick={() => setGrupoExpandidoId(grupo.clienteId)}><Icon nome="olho" /></button>}
                        </div>
                      </div>
                      {expanded && (
                        <>
                          <div className="mt-4 space-y-3 border-y border-line py-3">
                            {grupo.contas.map((conta) => {
                              const observacoes = conta.comanda.itens.flatMap((item) => item.observacao?.trim() ? [item.observacao.trim()] : []);
                              const totalPendurado = conta.pagamentos.reduce((soma, pagamento) => pagamento.sessaoCaixaId ? soma : soma + pagamento.valor, 0);
                              const selecionado = turnoReceberId[grupo.clienteId] === conta.id || (grupo.contas.length === 1);
                              return (
                                <div key={conta.id} className={'rounded-xl border p-3 ' + (selecionado && grupo.contas.length > 1 ? 'border-brand-600/50 bg-brand-600/5' : 'border-line bg-surface-lighter')}>
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-ink">Turno {dataTurnoLabel(conta)} · {conta.comanda.pontoVenda?.nome ?? 'Ponto de venda'}</p>
                                      <p className="mt-0.5 text-xs text-ink-muted">{rotuloConta(conta)} · Original: {formatCurrency(conta.valorOriginal)}{conta.recebido > 0 ? ' · Recebido: ' + formatCurrency(conta.recebido) : ''}{totalPendurado > 0 ? ' · Pendurado: ' + formatCurrency(totalPendurado) : ''}</p>
                                    </div>
                                    <strong className="tabular-nums text-orange-dark">{formatCurrency(conta.saldo)}</strong>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {conta.comanda.itens.slice(0, 4).map((item, index) => (
                                      <span key={conta.id + '-item-' + index} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink">{item.quantidade}× {item.nome ?? 'Item'}</span>
                                    ))}
                                    {conta.comanda.itens.length > 4 && <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-muted">+ {conta.comanda.itens.length - 4}</span>}
                                  </div>
                                  {observacoes.length > 0 && <p className="mt-2 text-xs text-ink-muted">Obs: {observacoes.join(' · ')}</p>}
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button type="button" className="touch-btn-orange inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs" onClick={() => setContaItensAbertos(conta)}>
                                      <Icon nome="itens" className="h-3.5 w-3.5 shrink-0" />
                                      Itens
                                    </button>
                                    {grupo.contas.length > 1 && (
                                      <button
                                        type="button"
                                        className={'inline-flex min-h-8 items-center rounded-lg border px-2.5 text-xs font-medium ' + (selecionado ? 'border-brand-600 bg-brand-600/15 text-ink' : 'border-line text-ink-muted')}
                                        onClick={() => setTurnoReceberId((prev) => ({ ...prev, [grupo.clienteId]: conta.id }))}
                                      >
                                        Receber este turno
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3 text-ink-muted">
                              <span className="text-xl leading-none text-brand-600" aria-hidden="true">↗</span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-ink-soft">Próximas ações</p>
                                <p className="mt-0.5 text-xs">
                                  {grupo.contas.length > 1
                                    ? (turnoSelecionado ? `Receber turno ${dataTurnoLabel(turnoSelecionado)} · ${formatCurrency(turnoSelecionado.saldo)}` : 'Selecione um turno para receber')
                                    : `${rotuloConta(grupo.contas[0])} · ${formatCurrency(grupo.saldo)}`}
                                </p>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:flex">
                              <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500" onClick={() => enviarCobranca(grupo)}>
                                <Icon nome="whatsapp" className="h-4 w-4" /><span>Enviar cobrança</span>
                              </button>
                              {podeReceberConta && (
                                <button
                                  type="button"
                                  className="touch-btn-primary inline-flex min-h-11 items-center justify-center gap-2 px-3 text-sm"
                                  disabled={!pontoAtivo || !turnoSelecionado}
                                  onClick={() => turnoSelecionado && abrirRecebimento(turnoSelecionado)}
                                >
                                  <Icon nome="cartao" className="h-4 w-4" /><span>Receber pagamento</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}
      {contas.length === 0 && <EmptyState icon="✓" title="Nenhuma conta pendente" description="As contas deixadas para pagamento futuro aparecerão aqui." />}

      {contaItensAbertos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setContaItensAbertos(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="conta-itens-titulo" className="max-h-[85vh] w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-line p-5">
              <div className="min-w-0"><h2 id="conta-itens-titulo" className="text-lg font-bold text-ink">Itens da comanda</h2><p className="mt-1 truncate text-sm text-ink-muted">{contaItensAbertos.cliente.nome} · {rotuloConta(contaItensAbertos)}</p></div>
              <button type="button" className="touch-btn-orange min-h-10 px-3 text-sm" onClick={() => setContaItensAbertos(null)}>Fechar</button>
            </header>
            <div className="max-h-[calc(85vh-86px)] space-y-2 overflow-y-auto p-5">
              {contaItensAbertos.comanda.itens.map((item, index) => (
                <div key={contaItensAbertos.id + '-modal-item-' + index} className="flex items-start gap-3 rounded-xl border border-line bg-surface-lighter p-3">
                  <span className="min-w-10 rounded-lg bg-brand-600/15 px-2 py-1 text-center text-sm font-bold text-brand-600">{item.quantidade}×</span>
                  <div className="min-w-0"><p className="font-medium text-ink">{item.nome ?? 'Item'}</p>{item.observacao?.trim() && <p className="mt-1 text-sm text-ink-muted">Obs: {item.observacao.trim()}</p>}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <PaymentFormModal
        open={Boolean(contaSelecionada) && podeReceberConta}
        onClose={() => setContaSelecionada(null)}
        title="Receber conta pendente"
        totalLabel="Saldo pendente"
        total={contaSelecionada?.saldo ?? 0}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        onConfirm={() => receber.mutate()}
        isPending={receber.isPending}
        allowPartial
        confirmMessage={(caixaAberto ? 'O recebimento será lançado na sessão de caixa aberta.' : 'Sem caixa aberto, o recebimento será identificado como Pendurado e não entrará no fechamento do turno.') + ' Se o valor for parcial, o restante continuará pendente.'}
        headerExtra={contaSelecionada ? (
          <div className="rounded-xl border border-line bg-surface-lighter p-3 text-sm">
            <strong>{contaSelecionada.cliente.nome}</strong>
            <p className="text-ink-muted">{formatPhone(contaSelecionada.cliente.telefone ?? '')} · Turno {dataTurnoLabel(contaSelecionada)} · {rotuloConta(contaSelecionada)}</p>
          </div>
        ) : undefined}
      />
    </div>
  );
}

function ResumoCard({ icon, label, value, detail, tone }: { icon: 'pessoa' | 'moeda' | 'tendencia'; label: string; value: string; detail: string; tone: 'blue' | 'orange' | 'green' }) {
  const colors = { blue: 'text-sky-400 bg-sky-400/10', orange: 'text-orange-400 bg-orange-400/10', green: 'text-emerald-400 bg-emerald-400/10' }[tone];
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-[#1c3548] bg-gradient-to-br from-[#102638] to-[#0b1a27] p-2.5 sm:gap-4 sm:p-5">
      <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-14 sm:w-14 ' + colors}><Icon nome={icon} className="h-5 w-5 sm:h-7 sm:w-7" /></span>
      <div className="min-w-0"><p className="text-[10px] leading-tight text-sky-100/75 sm:text-sm">{label}</p><p className={'truncate text-sm font-bold tabular-nums sm:text-2xl ' + colors.split(' ')[0]}>{value}</p><p className="hidden text-xs text-sky-100/60 sm:block">{detail}</p></div>
    </div>
  );
}

function FiltroButton({ active, icon, onClick, children }: { active: boolean; icon?: 'calendario' | 'relogio' | 'ordenar'; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ' + (active ? 'border-brand-600 bg-brand-600/15 text-ink' : 'border-line bg-surface text-ink-muted hover:border-brand-600/50 hover:text-ink')}>
      {icon && <Icon nome={icon} className="h-4 w-4" />}{children}
    </button>
  );
}

function StatusPill({ children, overdue = false }: { children: React.ReactNode; overdue?: boolean }) {
  return <span className={'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ' + (overdue ? 'border-danger/30 bg-danger/10 text-danger' : 'border-orange/30 bg-orange/10 text-orange-dark')}>{children}</span>;
}
