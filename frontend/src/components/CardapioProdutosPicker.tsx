import type { Produto } from '../types';
import { FORMATO_BEBIDA_LABELS } from '../types';
import { formatCurrency } from '../lib/api';

function groupCatalogo(catalogo: Produto[]) {
  return {
    comidas: catalogo.filter((p) => p.tipo === 'COMIDA'),
    bebidas: catalogo.filter((p) => p.tipo === 'BEBIDA'),
  };
}

export function CardapioProdutosPicker({
  catalogo,
  selectedIds,
  onToggle,
}: {
  catalogo: Produto[];
  selectedIds: string[];
  onToggle: (produtoId: string) => void;
}) {
  const { comidas, bebidas } = groupCatalogo(catalogo);

  const renderGroup = (titulo: string, items: Produto[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">{titulo}</h3>
        <div className="grid grid-cols-2 gap-2">
          {items.map((p) => {
            const checked = selectedIds.includes(p.id);
            const preco = p.precos[0];
            return (
              <label
                key={p.id}
                className={[
                  'flex items-start gap-2 rounded-xl border-2 p-2.5 cursor-pointer transition-colors min-w-0',
                  checked ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:border-brand-300',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0 accent-brand-600"
                  checked={checked}
                  onChange={() => onToggle(p.id)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink leading-snug">{p.nome}</span>
                  {preco && (
                    <span className="block text-xs text-brand-700 font-semibold mt-0.5">
                      {formatCurrency(preco.preco)}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  if (catalogo.length === 0) {
    return (
      <p className="text-sm text-ink-faint text-center py-3">
        Cadastre comida e bebidas em lata/garrafa no catálogo primeiro.
      </p>
    );
  }

  return (
    <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
      {renderGroup('Comida', comidas)}
      {renderGroup('Bebidas', bebidas)}
    </div>
  );
}

export function CardapioProdutosResumo({ produtos }: { produtos: Produto[] }) {
  if (produtos.length === 0) {
    return <p className="text-sm text-ink-faint">Nenhum item selecionado.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {produtos.map((p) => {
        const preco = p.precos[0];
        const extra = p.tipo === 'BEBIDA' && p.formato ? FORMATO_BEBIDA_LABELS[p.formato] : 'Comida';
        return (
          <span
            key={p.id}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink"
          >
            <span className="text-ink-muted font-medium">{extra}</span>
            {p.nome}
            {preco && <span className="text-brand-700">{formatCurrency(preco.preco)}</span>}
          </span>
        );
      })}
    </div>
  );
}
