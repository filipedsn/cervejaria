import { useMemo } from 'react';
import { formatCurrency } from '../../lib/api';
import type { ProdutoQuiosque } from '../../lib/quiosque';

interface Props {
  produtos: ProdutoQuiosque[];
  onSelecionar: (produto: ProdutoQuiosque) => void;
}

/** Grade de toque do PDV: um toque lanca uma unidade do produto. */
export function GradeProdutos({ produtos, onSelecionar }: Props) {
  const categorias = useMemo(() => {
    const agrupado = new Map<string, ProdutoQuiosque[]>();
    for (const produto of produtos) {
      const chave = produto.categoria?.trim() || 'Outros';
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
            {itens.map((produto) => (
              <button
                key={produto.id}
                type="button"
                onClick={() => onSelecionar(produto)}
                className="card flex min-h-20 flex-col justify-between gap-1 py-3 text-left active:scale-[0.98]"
              >
                <span className="font-semibold leading-tight">{produto.nome}</span>
                <span className="text-sm text-ink-faint">{formatCurrency(produto.precoUnit)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
