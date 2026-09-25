import { useMemo } from 'react';
import { formatCurrency } from '../../lib/api';
import type { ProdutoOperacao } from '../../lib/operacao';
import { normalizeCategoriaProduto } from '../../lib/operacao';
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
  const categorias = useMemo(() => {
    const agrupado = new Map<string, ProdutoOperacao[]>();
    for (const produto of produtos) {
      const chave = normalizeCategoriaProduto(produto.categoria);
      agrupado.set(chave, [...(agrupado.get(chave) ?? []), produto]);
    }
    return [...agrupado.entries()];
  }, [produtos]);

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

              return (
                <button
                  key={produto.id}
                  type="button"
                  disabled={esgotado}
                  onClick={() => onSelecionar(produto)}
                  className={`card-touch flex min-h-20 flex-col justify-between gap-1 py-3 text-left ${
                    esgotado ? 'opacity-50' : ''
                  }`}
                >
                  <span className="font-semibold leading-tight">{produto.nome}</span>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-ink-faint">{formatCurrency(precoDisplay)}</span>
                    {esgotado ? (
                      <span className="text-xs font-semibold text-red-600">Esgotado</span>
                    ) : baixo ? (
                      <span className="text-xs font-semibold text-orange-700">Estoque baixo · {saldo}</span>
                    ) : saldo !== null ? <span className="text-xs font-semibold text-ink-faint">{saldo} un</span> : null}
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
