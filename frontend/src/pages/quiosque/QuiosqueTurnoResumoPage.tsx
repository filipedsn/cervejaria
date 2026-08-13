import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency } from '../../lib/api';
import {
  FORMAS_PAGAMENTO,
  formatDuracaoTurnoMinutos,
  formatTurnoTitulo,
  pluralComandasQuiosque,
  type RelatorioTurnoCaixa,
} from '../../lib/quiosque';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';

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

export function QuiosqueTurnoResumoPage() {
  const { sessaoId } = useParams<{ sessaoId: string }>();
  const [searchParams] = useSearchParams();
  const dashboardHref = searchParams.toString()
    ? `/quiosque/dashboard?${searchParams.toString()}`
    : '/quiosque/dashboard';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['quiosque-turno-resumo', sessaoId],
    queryFn: () => api.get<RelatorioTurnoCaixa>(`/api/quiosque/caixa/sessoes/${sessaoId}`),
    enabled: Boolean(sessaoId),
    retry: false,
  });

  if (isLoading) return <Loading />;

  if (isError || !data) {
    return (
      <EmptyState
        title="Relatório disponível apenas para turnos encerrados"
        action={
          <Link to={dashboardHref} className="touch-btn-danger touch-btn-sm inline-block">
            Voltar ao dashboard
          </Link>
        }
      />
    );
  }

  const { caixa, pontoNome, abertoPorNome, fechadoPorNome } = data;
  const titulo = formatTurnoTitulo(caixa.abertoEm, caixa.fechadoEm!);

  return (
    <div className="space-y-6 pb-6">
      <div>
        <Link
          to={dashboardHref}
          aria-label="Voltar ao dashboard"
          className="touch-btn-danger touch-btn-sm inline-flex items-center gap-1.5 uppercase tracking-wide leading-none mb-3"
        >
          <ChevronLeftIcon className="w-5 h-5 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wide leading-none">Dashboard</span>
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
          </div>
          <span className="rounded-full bg-surface-lighter border border-line px-3 py-1 text-xs font-semibold text-ink-muted uppercase">
            Encerrado
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        <KpiCard label="Receita total" value={formatCurrency(caixa.esperado.totalVendas)} />
        <KpiCard label="Comandas" value={pluralComandasQuiosque(data.comandasAtendidas)} />
        <KpiCard label="Ticket médio" value={formatCurrency(data.ticketMedio)} />
        <KpiCard label="Receita/hora" value={`${formatCurrency(data.receitaPorHora)}/h`} />
        <KpiCard label="Duração" value={formatDuracaoTurnoMinutos(data.duracaoMinutos)} />
        {data.vendasAvulsas > 0 && (
          <KpiCard label="Vendas avulsas" value={String(data.vendasAvulsas)} />
        )}
        {data.itensVendidos > 0 && (
          <KpiCard label="Itens vendidos" value={String(data.itensVendidos)} />
        )}
      </div>

      {data.porProduto.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-label">Produtos vendidos</h2>
          <div className="card divide-y divide-line p-0 overflow-hidden">
            {data.porProduto.map((produto, i) => (
              <div key={produto.produtoId} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 text-sm font-bold text-ink-faint tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{produto.nome}</p>
                  <p className="text-xs text-ink-faint">
                    {produto.quantidade} un · {produto.percentual}%
                  </p>
                </div>
                <p className="font-bold text-brand-600 tabular-nums shrink-0">
                  {formatCurrency(produto.receita)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="card space-y-3">
        <h2 className="section-label">Conferência de fechamento</h2>
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

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card space-y-3">
          <h2 className="section-label">Gaveta</h2>
          <LinhaResumo rotulo="Troco inicial" valor={caixa.gaveta.trocoInicial} />
          <LinhaResumo rotulo="Vendas em dinheiro" valor={caixa.gaveta.entradasDinheiro} />
          <LinhaResumo rotulo="Suprimentos" valor={caixa.gaveta.suprimentos} />
          <LinhaResumo rotulo="Sangrias" valor={-caixa.gaveta.sangrias} />
          <div className="border-t border-line pt-2">
            <LinhaResumo rotulo="Dinheiro esperado na gaveta" valor={caixa.gaveta.esperadoDinheiro} destaque />
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="section-label">Vendas por forma</h2>
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
            <LinhaResumo rotulo="Total vendido" valor={caixa.esperado.totalVendas} destaque />
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
    </div>
  );
}
