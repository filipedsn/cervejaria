import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency } from '../../lib/api';
import { Loading } from '../Loading';
import type { OperacaoDashboardProdutoDetalhe, OperacaoDashboardProdutosLista } from '../../lib/operacao';

const TIPO_MOVIMENTO_LABEL: Record<string, string> = {
  ENTRADA: 'Entrada',
  SAIDA_VENDA: 'Saída venda',
  ESTORNO_VENDA: 'Estorno',
  PERDA: 'Perda',
  CORTESIA: 'Cortesia',
  CONSUMO_INTERNO: 'Consumo interno',
  AJUSTE: 'Ajuste',
};

function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

type Props = {
  dashboardQuery: string;
  pontoParam?: string;
};

export function OperacaoDashboardProdutosTab({ dashboardQuery, pontoParam }: Props) {
  const [busca, setBusca] = useState('');
  const [ordenar, setOrdenar] = useState<'receita' | 'quantidade'>('receita');
  const [incluirZerados, setIncluirZerados] = useState(false);
  const [produtoId, setProdutoId] = useState<string | null>(null);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  const qs = `${dashboardQuery}${pontoParam ? `&pontoVendaId=${encodeURIComponent(pontoParam)}` : ''}${
    incluirZerados ? '&incluirZerados=1' : ''
  }`;

  const listaQuery = useQuery({
    queryKey: ['operacao-dashboard-produtos', qs],
    queryFn: () => api.get<OperacaoDashboardProdutosLista>(`/api/operacao/dashboard/produtos?${qs}`),
    staleTime: 30_000,
  });

  const detalheQuery = useQuery({
    queryKey: ['operacao-dashboard-produto', produtoId, qs],
    queryFn: () =>
      api.get<OperacaoDashboardProdutoDetalhe>(
        `/api/operacao/dashboard/produtos/${encodeURIComponent(produtoId!)}?${qs}`,
      ),
    enabled: Boolean(produtoId),
    staleTime: 30_000,
  });

  const produtos = useMemo(() => {
    const rows = listaQuery.data?.produtos ?? [];
    const term = busca.trim().toLowerCase();
    const filtered = term ? rows.filter((row) => row.nome.toLowerCase().includes(term)) : rows;
    return [...filtered].sort((a, b) =>
      ordenar === 'quantidade'
        ? b.quantidadeVendida - a.quantidadeVendida || b.receita - a.receita
        : b.receita - a.receita || b.quantidadeVendida - a.quantidadeVendida,
    );
  }, [listaQuery.data?.produtos, busca, ordenar]);

  if (listaQuery.isLoading || !listaQuery.data) return <Loading />;

  const { controlaEstoque, escopoEstoque } = listaQuery.data;

  if (produtoId) {
    if (detalheQuery.isLoading || !detalheQuery.data) return <Loading />;
    const detalhe = detalheQuery.data;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <button
            type="button"
            className="touch-btn-secondary touch-btn-sm"
            onClick={() => {
              setProdutoId(null);
              setDiaAberto(null);
            }}
          >
            ← Voltar
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-ink leading-tight">{detalhe.produto.nome}</h2>
            <p className="text-sm text-ink-muted mt-0.5">{detalhe.periodo.label}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniKpi label="Vendidas" value={formatQty(detalhe.totais.quantidadeVendida)} />
          <MiniKpi label="Receita" value={formatCurrency(detalhe.totais.receita)} />
          {controlaEstoque && (
            <>
              <MiniKpi label="Entradas" value={formatQty(detalhe.totais.entradas)} />
              <MiniKpi
                label="Saldo atual"
                value={detalhe.totais.saldoAtual == null ? '—' : formatQty(detalhe.totais.saldoAtual)}
              />
            </>
          )}
        </div>

        {controlaEstoque && escopoEstoque === 'todas_unidades' && (
          <p className="text-xs text-ink-faint">Movimentos somados de todas as unidades.</p>
        )}

        {detalhe.dias.length === 0 ? (
          <p className="text-sm text-ink-muted py-8 text-center">Sem vendas nem movimentos neste período.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-faint">
                  <th className="px-3 py-2 font-semibold">Dia</th>
                  <th className="px-3 py-2 font-semibold text-right">Vend.</th>
                  <th className="px-3 py-2 font-semibold text-right">Receita</th>
                  {controlaEstoque && (
                    <>
                      <th className="px-3 py-2 font-semibold text-right">Entr.</th>
                      <th className="px-3 py-2 font-semibold text-right">S.venda</th>
                      <th className="px-3 py-2 font-semibold text-right">Estorno</th>
                      <th className="px-3 py-2 font-semibold text-right">Outros</th>
                      <th className="px-3 py-2 font-semibold text-right">Ajuste</th>
                      <th className="px-3 py-2 font-semibold text-right">Δ est.</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {detalhe.dias.map((dia) => {
                  const aberto = diaAberto === dia.dia;
                  return (
                    <FragmentDia
                      key={dia.dia}
                      dia={dia}
                      aberto={aberto}
                      controlaEstoque={controlaEstoque}
                      onToggle={() => setDiaAberto(aberto ? null : dia.dia)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="min-w-0 flex-1 text-xs text-ink-muted">
          Buscar produto
          <input
            type="search"
            className="input mt-1"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome do produto"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-ink-muted flex items-center gap-2">
            Ordenar
            <select
              className="input min-h-10 py-1"
              value={ordenar}
              onChange={(e) => setOrdenar(e.target.value as 'receita' | 'quantidade')}
            >
              <option value="receita">Receita</option>
              <option value="quantidade">Unidades</option>
            </select>
          </label>
          <label className="text-xs text-ink-muted flex items-center gap-2">
            <input
              type="checkbox"
              checked={incluirZerados}
              onChange={(e) => setIncluirZerados(e.target.checked)}
            />
            Mostrar zerados
          </label>
        </div>
      </div>

      {controlaEstoque && escopoEstoque === 'todas_unidades' && (
        <p className="text-xs text-ink-faint">Estoque somado de todas as unidades.</p>
      )}

      {produtos.length === 0 ? (
        <p className="text-sm text-ink-muted py-8 text-center">Nenhum produto com movimento no período.</p>
      ) : (
        <ul className="space-y-2">
          {produtos.map((row) => (
            <li key={row.produtoId}>
              <button
                type="button"
                onClick={() => setProdutoId(row.produtoId)}
                className="w-full rounded-2xl border border-line bg-surface px-3 py-3 text-left hover:border-brand-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{row.nome}</p>
                    <p className="text-xs text-ink-muted mt-1 tabular-nums">
                      {formatQty(row.quantidadeVendida)} un · {formatCurrency(row.receita)}
                      {controlaEstoque
                        ? ` · entr. ${formatQty(row.entradas)} · s.venda ${formatQty(row.saidasVenda)} · outros ${formatQty(row.outros)}`
                        : ''}
                    </p>
                  </div>
                  {controlaEstoque && row.saldoAtual != null && (
                    <p className="shrink-0 text-sm font-bold tabular-nums text-brand-600">
                      sal. {formatQty(row.saldoAtual)}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2">
      <p className="text-[11px] text-ink-faint">{label}</p>
      <p className="text-sm font-bold tabular-nums text-ink mt-0.5">{value}</p>
    </div>
  );
}

function FragmentDia({
  dia,
  aberto,
  controlaEstoque,
  onToggle,
}: {
  dia: OperacaoDashboardProdutoDetalhe['dias'][number];
  aberto: boolean;
  controlaEstoque: boolean;
  onToggle: () => void;
}) {
  const colSpan = controlaEstoque ? 9 : 3;
  return (
    <>
      <tr
        className="border-b border-line/70 cursor-pointer hover:bg-surface-lighter/60"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-medium tabular-nums whitespace-nowrap">
          {aberto ? '▾ ' : '▸ '}
          {dia.label}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{formatQty(dia.quantidadeVendida)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-600">
          {formatCurrency(dia.receita)}
        </td>
        {controlaEstoque && (
          <>
            <td className="px-3 py-2 text-right tabular-nums">{formatQty(dia.entradas)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatQty(dia.saidasVenda)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatQty(dia.estornos)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatQty(dia.outros)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatQty(dia.ajustes)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatQty(dia.deltaEstoque)}</td>
          </>
        )}
      </tr>
      {aberto && dia.movimentos.length > 0 && (
        <tr className="border-b border-line bg-surface-lighter/40">
          <td colSpan={colSpan} className="px-3 py-2">
            <ul className="space-y-1 text-xs text-ink-muted">
              {dia.movimentos.map((mov) => (
                <li key={mov.id} className="flex flex-wrap gap-x-2 tabular-nums">
                  <span>
                    {new Date(mov.createdAt).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="font-medium text-ink">
                    {TIPO_MOVIMENTO_LABEL[mov.tipo] ?? mov.tipo}
                  </span>
                  <span>{formatQty(mov.quantidade)}</span>
                  {mov.observacao ? <span className="text-ink-faint">— {mov.observacao}</span> : null}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
      {aberto && controlaEstoque && dia.movimentos.length === 0 && (
        <tr className="border-b border-line bg-surface-lighter/40">
          <td colSpan={colSpan} className="px-3 py-2 text-xs text-ink-faint">
            Sem lançamentos de estoque neste dia (só venda registrada).
          </td>
        </tr>
      )}
    </>
  );
}
