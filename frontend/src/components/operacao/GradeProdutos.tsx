import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency } from '../../lib/api';
import type { ProdutoOperacao } from '../../lib/operacao';
import { CATEGORIAS_PRODUTO_OPERACAO, isChopeOperacao, normalizeCategoriaProduto } from '../../lib/operacao';
import type { SaldoEstoque } from '../../lib/operacao';

interface Props {
  produtos: ProdutoOperacao[];
  onSelecionar: (produto: ProdutoOperacao) => void;
  /** Saldo por produtoId, quando o modulo controla estoque. */
  saldos?: Map<string, SaldoEstoque>;
  controlaEstoque?: boolean;
  /** Unidades ja selecionadas nesta rodada (para calcular saldo restante). */
  quantidadesNoCarrinho?: Map<string, number>;
}

/** Grade de toque do PDV: um toque lanca uma unidade do produto. */
export function GradeProdutos({
  produtos,
  onSelecionar,
  saldos,
  controlaEstoque = false,
  quantidadesNoCarrinho,
}: Props) {
  const { data: categoriaConfig } = useQuery({
    queryKey: ['operacao-categorias'],
    queryFn: () => api.get<{ ordem: string[] }>('/api/operacao/produtos/categorias'),
  });
  const ordemCategorias = categoriaConfig?.ordem ?? CATEGORIAS_PRODUTO_OPERACAO;
  const categorias = useMemo(() => {
    const agrupado = new Map<string, ProdutoOperacao[]>();
    for (const produto of produtos) {
      const chave = normalizeCategoriaProduto(produto.categoria);
      agrupado.set(chave, [...(agrupado.get(chave) ?? []), produto]);
    }
    const prioridade = new Map(ordemCategorias.map((categoria, index) => [categoria, index]));
    return [...agrupado.entries()].sort(([a], [b]) => (prioridade.get(a) ?? Infinity) - (prioridade.get(b) ?? Infinity));
  }, [produtos, ordemCategorias]);

  return (
    <div className="space-y-4">
      {categorias.map(([categoria, itens]) => (
        <section key={categoria} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {categoria}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {itens.map((produto) => {
              const saldoEstoque =
                controlaEstoque && produto.controlaEstoque
                  ? saldos?.get(produto.id)
                  : null;
              const noCarrinho = quantidadesNoCarrinho?.get(produto.id) ?? 0;
              const saldo =
                saldoEstoque !== null && saldoEstoque !== undefined
                  ? Math.max(0, saldoEstoque.quantidade - noCarrinho)
                  : saldoEstoque === undefined && controlaEstoque && produto.controlaEstoque ? 0 : null;
              const esgotado = saldo !== null && saldo <= 0;
              const baixo = saldo !== null && saldo > 0 && saldoEstoque?.statusEstoque === 'LOW';
              const precoDisplay = produto.precoEfetivo ?? (parseFloat(produto.precoUnit) || 0);
              const chope = isChopeOperacao(produto);
              const volumesComerciais = (produto.precos ?? []).filter((preco) => preco.volumeMl > 1);
              const volumeMenu = chope
                ? ((produto.volumeMl ?? 0) > 1 ? produto.volumeMl! : volumesComerciais.length === 1 ? volumesComerciais[0]!.volumeMl : 0)
                : 0;
              const produtoSelecionado = chope && volumeMenu > 1
                ? { ...produto, volumeMl: volumeMenu, precos: (produto.precos ?? []).filter((preco) => preco.volumeMl === volumeMenu) }
                : produto;

              return (
                <button
                  key={`${produto.id}:${volumeMenu}`}
                  type="button"
                  disabled={esgotado}
                  onClick={() => onSelecionar(produtoSelecionado)}
                  className={`card-touch flex min-h-20 flex-col justify-between gap-1 py-3 text-left ${
                    esgotado ? 'opacity-50' : ''
                  }`}
                >
                  <span className="font-semibold leading-tight">{produto.nome}{volumeMenu > 1 ? ` (${volumeMenu} ml)` : ''}</span>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-ink-faint">{formatCurrency(precoDisplay)}</span>
                    {esgotado ? (
                      <span className="text-xs font-semibold text-red-600">Esgotado</span>
                    ) : baixo ? (
                      <span className="text-xs font-semibold text-orange-700">Estoque baixo · {saldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {saldoEstoque?.unidadeEstoque ?? 'un'}</span>
                      ) : saldo !== null ? <span className="text-xs font-semibold text-ink-faint">{saldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {saldoEstoque?.unidadeEstoque ?? 'un'}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
