import { useMemo } from 'react';
import { formatCurrency } from '../../lib/api';
import type { ProdutoQuiosque } from '../../lib/quiosque';
import { normalizeCategoriaProduto } from '../../lib/quiosque';

interface Props {
  produtos: ProdutoQuiosque[];
  onSelecionar: (produto: ProdutoQuiosque) => void;
  /** Saldo por produtoId, quando o modulo controla estoque. */
  saldos?: Map<string, number>;
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
    const agrupado = new Map<string, ProdutoQuiosque[]>();
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
              const saldoBruto =
                controlaEstoque && produto.controlaEstoque
                  ? (saldos?.get(produto.id) ?? 0)
                  : null;
              const noCarrinho = quantidadesNoCarrinho?.get(produto.id) ?? 0;
              const saldo =
                saldoBruto !== null ? Math.max(0, saldoBruto - noCarrinho) : null;
              const esgotado = saldo !== null && saldo <= 0;
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
                    {saldo !== null && (
                      <span className={`text-xs font-semibold ${esgotado ? 'text-red-600' : 'text-ink-faint'}`}>
                        {saldo} un
                      </span>
                    )}
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
