import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency } from '../../lib/api';
import {
  FORMAS_PAGAMENTO,
  formatDuracaoTurnoMinutos,
  formatTurnoTitulo,
  pluralComandasOperacao,
  rotuloComanda,
  type ComandasTurnoPage,
  type RecebimentoDividaAnteriorTurno,
  type RelatorioTurnoCaixa,
} from '../../lib/operacao';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { ComandaEspelhoTurnoModal } from '../../components/operacao/ComandaEspelhoTurnoModal';

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card py-4 px-4">
      <p className="section-label">{label}</p>
      <p className="text-xl sm:text-2xl font-bold text-brand-600 tabular-nums mt-1.5 leading-none">{value}</p>
    </div>
  );
}

function LinhaResumo({ rotulo, valor, destaque = false }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between py-1 ${destaque ? 'font-semibold' : ''}`}>
      <span className="text-sm text-ink-faint">{rotulo}</span>
      <span className="tabular-nums">{formatCurrency(valor)}</span>
    </div>
  );
}

function Diferenca({ valor }: { valor: number }) {
  if (valor === 0) return <span className="text-sm text-ink-faint">confere</span>;
  const positivo = valor > 0;
  return (
    <span className={`text-sm font-semibold tabular-nums ${positivo ? 'text-green-600' : 'text-red-600'}`}>
      {positivo ? '+' : ''}
      {formatCurrency(valor)}
    </span>
  );
}

export function OperacaoTurnoResumoPage() {
  const [comandaEspelho, setComandaEspelho] = useState<{ id: string; contexto: 'VENDA' | 'CANCELAMENTO_TURNO' | 'RECEBIMENTO_DIVIDA_ANTERIOR' } | null>(null);
  const [paginaComandas, setPaginaComandas] = useState(1);
  const [filtroComandas, setFiltroComandas] = useState<'TODOS' | 'COMANDAS' | 'AVULSAS' | 'CANCELADAS'>('TODOS');
  const { sessaoId } = useParams<{ sessaoId: string }>();
  const [searchParams] = useSearchParams();
  const dashboardHref = searchParams.toString()
    ? `/operacao/dashboard?${searchParams.toString()}`
    : '/operacao/dashboard';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['operacao-turno-resumo', sessaoId],
    queryFn: () => api.get<RelatorioTurnoCaixa>(`/api/operacao/caixa/sessoes/${sessaoId}`),
    enabled: Boolean(sessaoId),
    retry: false,
  });

  useEffect(() => {
    setPaginaComandas(1);
    setFiltroComandas('TODOS');
    setComandaEspelho(null);
  }, [sessaoId]);

  const comandasTurnoQuery = useQuery({
    queryKey: ['operacao-turno-comandas', sessaoId, paginaComandas, filtroComandas],
    queryFn: () => api.get<ComandasTurnoPage>(`/api/operacao/caixa/sessoes/${encodeURIComponent(sessaoId!)}/comandas?${new URLSearchParams({ page: String(paginaComandas), pageSize: '25', tipo: filtroComandas })}`),
    enabled: Boolean(sessaoId),
    retry: false,
  });

  const recebimentosAnterioresQuery = useQuery({
    queryKey: ['operacao-turno-recebimentos-anteriores', sessaoId],
    queryFn: () => api.get<RecebimentoDividaAnteriorTurno[]>(`/api/operacao/caixa/sessoes/${encodeURIComponent(sessaoId!)}/recebimentos-anteriores`),
    enabled: Boolean(sessaoId),
    retry: false,
  });

  if (isLoading) return <Loading />;

  if (isError || !data) {
    return (
      <EmptyState
        title="Relatório disponível apenas para turnos encerrados"
        action={
          <Link to={dashboardHref} className="touch-btn-orange touch-btn-sm inline-block">
            Voltar ao dashboard
          </Link>
        }
      />
    );
  }

  const { caixa, pontoNome, abertoPorNome, fechadoPorNome } = data;
  const titulo = formatTurnoTitulo(caixa.abertoEm, caixa.fechadoEm!);
  const conferenciaFisicaPendente = data.conferenciaFisicaPendente ?? caixa.tipoEncerramento === 'ADMINISTRATIVO';
  if (!data.dadosFinanceirosDisponiveis) {
    return (
      <div className="space-y-6 pb-6">
        <div>
          <Link to={dashboardHref} className="touch-btn-secondary touch-btn-sm inline-flex items-center gap-1.5 mb-3">Quadro</Link>
          <p className="page-eyebrow">Relatório do turno</p>
          <h1 className="page-title">{titulo}</h1>
          <p className="page-subtitle">{pontoNome}</p>
          <p className="text-sm text-ink-faint mt-0.5">
            Aberto por {abertoPorNome}{fechadoPorNome ? ` · Encerrado por ${fechadoPorNome}` : ''}
          </p>
        </div>
        <section className="card space-y-2 border-amber-500/30" role="status">
          <h2 className="font-semibold text-amber-700">Encerramento administrativo</h2>
          <p className="text-sm text-amber-700">Conferência financeira pendente. As contagens permanecem desconhecidas; nenhum total ou venda foi associado por horário.</p>
          {caixa.observacaoFechamento && <p className="text-sm text-ink-faint">Motivo: {caixa.observacaoFechamento}</p>}
        </section>
      </div>
    );
  }
  const produtosPorCategoria = data.porProduto.reduce((categorias, produto) => {
    const produtos = categorias.get(produto.categoria) ?? [];
    produtos.push(produto);
    categorias.set(produto.categoria, produtos);
    return categorias;
  }, new Map<string, typeof data.porProduto>());
  const fiadoVendido = data.fiadoVendido ?? 0;
  const fiadoQuitadoNoTurno = data.fiadoQuitadoNoTurno ?? 0;
  const fiadoQuitadoDepois = data.fiadoQuitadoDepois ?? 0;

  return (
    <div className="space-y-6 pb-6">
      <div>
        <Link
          to={dashboardHref}
          aria-label="Voltar ao dashboard"
          className="touch-btn-secondary touch-btn-sm inline-flex items-center gap-1.5 uppercase tracking-wide leading-none mb-3"
        >
          <ChevronLeftIcon className="w-5 h-5 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wide leading-none">Quadro</span>
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="page-eyebrow">Relatório do turno</p>
            <h1 className="page-title">{titulo}</h1>
            <p className="page-subtitle">{pontoNome}</p>
            <p className="text-sm text-ink-faint mt-0.5">
              Aberto por {abertoPorNome}
              {fechadoPorNome ? ` · Fechado por ${fechadoPorNome}` : ''}
            </p>
            {conferenciaFisicaPendente ? (
              <div className="mt-2 space-y-0.5" role="status">
                <p className="text-sm font-semibold text-amber-700">
                  Encerramento administrativo · contagem física do caixa pendente
                </p>
                {caixa.observacaoFechamento && (
                  <p className="text-xs text-ink-faint">Motivo: {caixa.observacaoFechamento}</p>
                )}
              </div>
            ) : caixa.tipoEncerramento === 'FINANCEIRO' ? (
              <p className="mt-2 text-sm font-semibold text-green-700">Fechamento financeiro conferido</p>
            ) : (
              <p className="mt-2 text-sm text-ink-faint">Encerramento histórico sem classificação</p>
            )}
          </div>
          <span className="rounded-full bg-surface-lighter border border-line px-3 py-1 text-xs font-semibold text-ink-muted uppercase">
            Encerrado
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        <KpiCard label="Vendas na janela histórica" value={formatCurrency(data.vendasTotal ?? 0)} />
        <KpiCard label="Recebido no turno" value={formatCurrency(data.totalRecebido ?? 0)} />
        <KpiCard label="Vendido fiado" value={formatCurrency(fiadoVendido)} />
        {fiadoQuitadoDepois > 0 && (
          <KpiCard label="Fiado quitado depois" value={formatCurrency(fiadoQuitadoDepois)} />
        )}
        <KpiCard label="Fiado pendente" value={formatCurrency(data.totalPendente ?? 0)} />
        <KpiCard label="Comandas na janela histórica" value={pluralComandasOperacao(data.comandasAtendidas ?? 0)} />
        <KpiCard label="Ticket médio por venda" value={formatCurrency(data.ticketMedio ?? 0)} />
        <KpiCard label="Receita/hora" value={`${formatCurrency(data.receitaPorHora ?? 0)}/h`} />
        <KpiCard label="Duração" value={formatDuracaoTurnoMinutos(data.duracaoMinutos ?? 0)} />
        {(data.vendasAvulsas ?? 0) > 0 && (
          <KpiCard label="Vendas avulsas na janela histórica" value={String(data.vendasAvulsas)} />
        )}
        {(data.itensVendidos ?? 0) > 0 && (
          <KpiCard label="Itens vendidos" value={String(data.itensVendidos)} />
        )}
      </div>

      <section className="card space-y-4" data-testid="turno-comandas-encerradas">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-label">Comandas e vendas avulsas do histórico do turno</h2>
          <p className="text-xs text-ink-faint">Somente leitura — caixa encerrado, sem reabertura</p>
        </div>
        {comandasTurnoQuery.isLoading && <p className="text-sm text-ink-faint">Carregando comandas…</p>}
        {comandasTurnoQuery.isError && (
          <p className="text-sm text-red-600" role="alert">
            Não foi possível carregar as comandas deste turno. Verifique a permissão de leitura.
          </p>
        )}
        {comandasTurnoQuery.isSuccess && (comandasTurnoQuery.data?.escopo.totalRegistros ?? 0) === 0 && (
          <p className="text-sm text-ink-faint">Nenhuma comanda ou venda avulsa registrada no escopo deste turno.</p>
        )}
        {comandasTurnoQuery.isSuccess && comandasTurnoQuery.data && comandasTurnoQuery.data.escopo.totalRegistros > 0 && (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar registros do turno">
              {([
                ['TODOS', `Todos (${comandasTurnoQuery.data.escopo.totalRegistros})`],
                ['COMANDAS', `Comandas (${comandasTurnoQuery.data.escopo.comandas})`],
                ['AVULSAS', `Vendas avulsas (${comandasTurnoQuery.data.escopo.vendasAvulsas})`],
                ['CANCELADAS', `Canceladas (${comandasTurnoQuery.data.escopo.comandasCanceladas})`],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={filtroComandas === value} className={filtroComandas === value ? 'touch-btn-orange touch-btn-sm' : 'touch-btn-secondary touch-btn-sm'} onClick={() => { setFiltroComandas(value); setPaginaComandas(1); }}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-faint" data-testid="turno-comandas-paginacao">
              Filtro ativo: {filtroComandas === 'TODOS' ? 'todos os tipos e status' : filtroComandas === 'COMANDAS' ? 'comandas fechadas' : filtroComandas === 'AVULSAS' ? 'vendas avulsas fechadas' : 'comandas canceladas'} · Exibindo {comandasTurnoQuery.data.paginacao.de}–{comandasTurnoQuery.data.paginacao.ate} de {comandasTurnoQuery.data.paginacao.totalFiltrado} filtrados; escopo total {comandasTurnoQuery.data.escopo.totalRegistros} ({comandasTurnoQuery.data.escopo.comandas} comandas, {comandasTurnoQuery.data.escopo.vendasAvulsas} vendas avulsas, {comandasTurnoQuery.data.escopo.comandasCanceladas} canceladas).
            </p>
            <div className="divide-y divide-line" data-testid="turno-comandas-lista">
              {comandasTurnoQuery.data.dados.map((comanda) => {
                const formas = comanda.pagamentos
                  .map((pagamento) => FORMAS_PAGAMENTO.find((item) => item.valor === pagamento.forma)?.label ?? pagamento.forma)
                  .join(', ');
                const itensAtivos = comanda.pedidos
                  .flatMap((pedido) => pedido.itens)
                  .filter((item) => !item.canceladoEm && !item.cancelamentoPendenteEm);
                const itensCancelados = comanda.pedidos
                  .flatMap((pedido) => pedido.itens)
                  .filter((item) => Boolean(item.canceladoEm));
                return (
                  <div key={comanda.id} data-command-id={comanda.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold break-words">{rotuloComanda(comanda)}</p>
                      <p className="text-xs text-ink-faint">
                        {comanda.status === 'CANCELADA' ? 'Comanda cancelada · ' : comanda.tipo === 'AVULSA' ? 'Venda avulsa · ' : 'Comanda · '}
                        {comanda.numero != null ? `Nº ${comanda.numero} · ` : ''}
                        {formatCurrency(comanda.total)}
                        {formas ? ` · ${formas}` : ' · sem pagamento registrado'}
                      </p>
                      <p className="text-xs text-ink-faint mt-0.5">
                        {itensAtivos.length} item(ns) ativos
                        {itensCancelados.length > 0 ? ` · ${itensCancelados.length} cancelado(s)` : ''}
                      </p>
                      <p className="text-[11px] text-ink-faint mt-1">
                        Pagamentos listados são os registrados no sistema; valores da maquininha exigem conferência externa.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="touch-btn-secondary touch-btn-sm shrink-0"
                      onClick={() => setComandaEspelho({ id: comanda.id, contexto: comanda.status === 'CANCELADA' ? 'CANCELAMENTO_TURNO' : 'VENDA' })}
                    >
                      Ver detalhes
                    </button>
                  </div>
                );
              })}
          </div>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <button type="button" className="touch-btn-secondary touch-btn-sm" disabled={comandasTurnoQuery.data.paginacao.pagina <= 1} onClick={() => setPaginaComandas((page) => Math.max(1, page - 1))}>Anterior</button>
            <span className="text-sm tabular-nums">Página {comandasTurnoQuery.data.paginacao.pagina} de {comandasTurnoQuery.data.paginacao.paginas}</span>
              <button type="button" className="touch-btn-secondary touch-btn-sm" disabled={comandasTurnoQuery.data.paginacao.pagina >= comandasTurnoQuery.data.paginacao.paginas} onClick={() => setPaginaComandas((page) => page + 1)}>Próxima</button>
            </div>
          </>
        )}
      </section>

      <section className="card space-y-3" data-testid="turno-recebimentos-anteriores">
        <h2 className="section-label">Dívidas anteriores recebidas neste turno</h2>
        <p className="text-xs text-ink-faint">Esses pagamentos entram no recebido do caixa, mas não contam como vendas originadas neste turno.</p>
        {recebimentosAnterioresQuery.isLoading && <p className="text-sm text-ink-faint">Carregando recebimentos…</p>}
        {recebimentosAnterioresQuery.isError && <p className="text-sm text-red-600" role="alert">Não foi possível carregar as dívidas anteriores recebidas neste turno.</p>}
        {recebimentosAnterioresQuery.isSuccess && recebimentosAnterioresQuery.data.length === 0 && <p className="text-sm text-ink-faint">Nenhuma dívida anterior recebida neste turno.</p>}
        {recebimentosAnterioresQuery.data?.map((row) => (
          <div key={row.comanda.id} data-command-id={row.comanda.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">{row.comanda.identificador || row.comanda.cliente?.nome || 'Comanda anterior'}{row.comanda.numero != null ? ` · Nº ${row.comanda.numero}` : ''}</p>
              <p className="text-xs text-ink-faint">Venda fechada {row.comanda.fechadaEm ? new Date(row.comanda.fechadaEm).toLocaleString('pt-BR') : 'em data não registrada'} · Recebido agora: {formatCurrency(row.recebidoNesteTurno)}</p>
              {row.pagamentos.map((pagamento) => <p key={pagamento.id} className="text-xs text-ink-muted">{FORMAS_PAGAMENTO.find((forma) => forma.valor === pagamento.forma)?.label ?? pagamento.forma} · {formatCurrency(pagamento.valor)} · {new Date(pagamento.pagoEm).toLocaleString('pt-BR')}</p>)}
            </div>
            <button type="button" className="touch-btn-secondary touch-btn-sm shrink-0" onClick={() => setComandaEspelho({ id: row.comanda.id, contexto: 'RECEBIMENTO_DIVIDA_ANTERIOR' })}>Ver detalhes</button>
          </div>
        ))}
      </section>

      {data.porProduto.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-label">Produtos vendidos por categoria</h2>
          {[...produtosPorCategoria.entries()].map(([categoria, produtos]) => (
            <div key={categoria} className="card divide-y divide-line p-0 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-surface-lighter">
                <h3 className="font-semibold">{categoria}</h3>
                <span className="font-semibold text-brand-600 tabular-nums">
                  {formatCurrency(produtos.reduce((soma, produto) => soma + produto.receita, 0))}
                </span>
              </div>
              {produtos.map((produto) => (
                <div key={`${produto.produtoId}:${produto.volumeMl}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{produto.nome}</p>
                    <p className="text-xs text-ink-faint">{produto.quantidade} un</p>
                  </div>
                  <p className="font-bold text-brand-600 tabular-nums shrink-0">
                    {formatCurrency(produto.receita)}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-label">Fiado deste turno</h2>
          <span className="font-bold text-brand-600 tabular-nums">{formatCurrency(fiadoVendido)}</span>
        </div>
        <div>
          <LinhaResumo rotulo="Vendido fiado" valor={fiadoVendido} />
          <LinhaResumo rotulo="Quitado neste caixa" valor={fiadoQuitadoNoTurno} />
          <LinhaResumo rotulo="Quitado depois do turno" valor={fiadoQuitadoDepois} />
          <div className="border-t border-line pt-2">
            <LinhaResumo rotulo="Pendente" valor={data.totalPendente ?? 0} destaque />
          </div>
        </div>
        <p className="text-xs text-ink-faint">
          Quitações registradas neste caixa entram no fechamento; quitações feitas depois ficam só no histórico da conta e não alteram a conferência.
        </p>
        {data.contasReceber.length === 0 ? (
          <p className="text-sm text-ink-faint">Nenhuma venda fiado neste turno.</p>
        ) : (
          <div className="divide-y divide-line">
            {data.contasReceber.map((conta) => (
              <div key={conta.contaReceberId} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{conta.clienteNome}</p>
                  <p className="text-xs text-ink-faint">
                    {conta.comandaNumero !== null ? `Comanda ${conta.comandaNumero}` : conta.identificador || 'Comanda sem identificação'}
                    {` · Original ${formatCurrency(conta.valorOriginal)} · Recebido ${formatCurrency(conta.recebido)} · Saldo ${formatCurrency(conta.saldo)}`}
                  </p>
                  {conta.recebimentos.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-ink-faint">
                      {conta.recebimentos.map((pagamento, index) => {
                        const forma = FORMAS_PAGAMENTO.find((item) => item.valor === pagamento.forma)?.label ?? pagamento.forma;
                        const dataPagamento = new Date(pagamento.pagoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
                        return (
                          <li key={`${conta.contaReceberId}:${index}`}>
                            {forma}: {formatCurrency(pagamento.valor)} · {dataPagamento} · {pagamento.nesteTurno ? 'quitado neste caixa' : 'quitado depois do turno'}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <p className="font-bold text-brand-600 tabular-nums">{formatCurrency(conta.saldo)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="section-label">Top 5 clientes por consumo</h2>
        {data.topClientes.length === 0 ? (
          <p className="text-sm text-ink-faint">Nenhuma comanda deste turno está vinculada a um cliente.</p>
        ) : (
          <div className="divide-y divide-line">
            {data.topClientes.map((cliente, i) => (
              <div key={cliente.clienteId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="w-6 text-sm font-bold text-ink-faint tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{cliente.nome}</p>
                  <p className="text-xs text-ink-faint">
                    {cliente.comandas} {cliente.comandas === 1 ? 'comanda' : 'comandas'}
                  </p>
                </div>
                <p className="font-bold text-brand-600 tabular-nums">{formatCurrency(cliente.consumo)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {conferenciaFisicaPendente ? (
        <p className="card text-sm text-amber-700">
          Sem contagem física: vendas são as comandas vinculadas a este turno e recebimentos são os pagamentos registrados neste caixa.
        </p>
      ) : (
      <div className="card space-y-3">
        <h2 className="section-label">Conferência de fechamento</h2>
        <p className="text-xs text-ink-faint">
          Esta conferência considera somente pagamentos registrados neste caixa.
        </p>
        {FORMAS_PAGAMENTO.map((forma) => {
          const esperadoChave =
            forma.valor === 'DINHEIRO'
              ? 'dinheiro'
              : forma.valor === 'PIX'
                ? 'pix'
                : forma.valor === 'CARTAO_DEBITO'
                  ? 'cartaoDebito'
                  : 'cartaoCredito';
          const contadoChave = esperadoChave;
          const esperado =
            forma.valor === 'DINHEIRO'
              ? caixa.gaveta.esperadoDinheiro
              : (caixa.esperado[esperadoChave as keyof typeof caixa.esperado] as number);
          const contadoValor = caixa.contado?.[contadoChave as keyof NonNullable<typeof caixa.contado>] ?? 0;
          const diff = caixa.diferencas?.[contadoChave as keyof NonNullable<typeof caixa.diferencas>] ?? 0;

          return (
            <div key={forma.valor} className="flex items-baseline justify-between gap-2 text-sm">
              <span>{forma.label}</span>
              <div className="text-right">
                <div className="tabular-nums">
                  {formatCurrency(contadoValor)}{' '}
                  <span className="text-ink-faint">/ {formatCurrency(esperado)}</span>
                </div>
                <Diferenca valor={diff} />
              </div>
            </div>
          );
        })}
        {caixa.observacaoFechamento && (
          <p className="text-sm text-ink-faint pt-2 border-t border-line">
            Obs.: {caixa.observacaoFechamento}
          </p>
        )}
      </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card space-y-3">
          <h2 className="section-label">Gaveta</h2>
          <LinhaResumo rotulo="Troco inicial" valor={caixa.gaveta.trocoInicial} />
          <LinhaResumo rotulo="Recebimentos em dinheiro" valor={caixa.gaveta.entradasDinheiro} />
          <LinhaResumo rotulo="Suprimentos" valor={caixa.gaveta.suprimentos} />
          <LinhaResumo rotulo="Sangrias" valor={-caixa.gaveta.sangrias} />
          <div className="border-t border-line pt-2">
            <LinhaResumo rotulo="Dinheiro esperado na gaveta" valor={caixa.gaveta.esperadoDinheiro} destaque />
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="section-label">Recebimentos registrados neste caixa</h2>
          {FORMAS_PAGAMENTO.map((forma) => {
            const chave =
              forma.valor === 'DINHEIRO'
                ? 'dinheiro'
                : forma.valor === 'PIX'
                  ? 'pix'
                  : forma.valor === 'CARTAO_DEBITO'
                    ? 'cartaoDebito'
                    : 'cartaoCredito';
            const valor = caixa.esperado[chave as keyof typeof caixa.esperado] as number;
            return <LinhaResumo key={forma.valor} rotulo={forma.label} valor={valor} />;
          })}
          <div className="border-t border-line pt-2">
            <LinhaResumo rotulo="Total recebido" valor={caixa.esperado.totalVendas} destaque />
          </div>
        </section>
      </div>

      {caixa.movimentos.length > 0 && (
        <section className="card space-y-2">
          <h2 className="section-label">Movimentos</h2>
          {caixa.movimentos.map((mov) => (
            <div key={mov.id} className="flex items-baseline justify-between gap-2 text-sm">
              <span>
                {mov.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}
                {mov.observacao ? ` — ${mov.observacao}` : ''}
              </span>
              <span className={`tabular-nums ${mov.tipo === 'SANGRIA' ? 'text-red-600' : 'text-green-600'}`}>
                {mov.tipo === 'SANGRIA' ? '-' : '+'}
                {formatCurrency(mov.valor)}
              </span>
            </div>
          ))}
        </section>
      )}
      {comandaEspelho && (
        <ComandaEspelhoTurnoModal
          key={`${comandaEspelho.contexto}:${comandaEspelho.id}`}
          comandaId={comandaEspelho.id}
          pontoVendaId={caixa.pontoVendaId}
          sessaoCaixaId={sessaoId!}
          contexto={comandaEspelho.contexto}
          onClose={() => setComandaEspelho(null)}
        />
      )}
    </div>
  );
}
