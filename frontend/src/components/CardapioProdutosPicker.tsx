import type { CardapioItem, Produto } from '../types';
import { FORMATO_BEBIDA_LABELS } from '../types';
import { formatCurrency } from '../lib/api';
import { CurrencyInput } from './CurrencyInput';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../lib/currency';

function groupCatalogo(catalogo: Produto[]) {
  return {
    comidas: catalogo.filter((p) => p.tipo === 'COMIDA'),
    bebidas: catalogo.filter((p) => p.tipo === 'BEBIDA'),
  };
}

function defaultPrecoCatalogo(produto: Produto): number {
  const preco = produto.precos[0]?.preco;
  return preco !== undefined ? parseFloat(String(preco)) : 0;
}

type TemplatePickerProps = {
  catalogo: Produto[];
  itens: CardapioItem[];
  onToggle: (produtoId: string, defaultPreco: number) => void;
  onPrecoChange: (produtoId: string, precoUnit: number) => void;
  selectedIds?: never;
};

type SelectionPickerProps = {
  catalogo: Produto[];
  selectedIds: string[];
  onToggle: (produtoId: string) => void;
  itens?: never;
  onPrecoChange?: never;
};

export function CardapioProdutosPicker(props: TemplatePickerProps | SelectionPickerProps) {
  const { catalogo } = props;
  const isTemplateMode = 'itens' in props && props.itens !== undefined;
  const precoPorId = isTemplateMode
    ? new Map(props.itens.map((i) => [i.produtoId, i.precoUnit]))
    : null;
  const selectedSet = isTemplateMode ? precoPorId! : new Set(props.selectedIds);

  const { comidas, bebidas } = groupCatalogo(catalogo);

  const renderGroup = (titulo: string, items: Produto[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">{titulo}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map((p) => {
            const checked = isTemplateMode ? precoPorId!.has(p.id) : selectedSet.has(p.id);
            const catalogoPreco = defaultPrecoCatalogo(p);
            return (
              <div
                key={p.id}
                className={[
                  'rounded-xl border-2 p-2.5 transition-colors min-w-0',
                  checked ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface',
                ].join(' ')}
              >
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0 accent-brand-600"
                    checked={checked}
                    onChange={() => {
                      if (isTemplateMode) {
                        props.onToggle(p.id, catalogoPreco);
                      } else {
                        props.onToggle(p.id);
                      }
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink leading-snug">{p.nome}</span>
                    <span className="block text-xs text-ink-faint mt-0.5">
                      {isTemplateMode ? `Catálogo: ${formatCurrency(catalogoPreco)}` : formatCurrency(catalogoPreco)}
                    </span>
                  </span>
                </label>
                {isTemplateMode && checked && (
                  <div className="mt-2 pl-6">
                    <label className="text-xs font-medium text-ink-muted">Preço no cardápio</label>
                    <CurrencyInput
                      className="input mt-1"
                      value={formatCurrencyInputFromNumber(precoPorId!.get(p.id) ?? catalogoPreco)}
                      onChange={(value) => {
                        const val = parseCurrencyInput(value);
                        if (val > 0) props.onPrecoChange(p.id, val);
                      }}
                    />
                  </div>
                )}
              </div>
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

export function CardapioProdutosResumo({
  produtos,
  itens,
}: {
  produtos: Produto[];
  itens?: CardapioItem[];
}) {
  if (produtos.length === 0) {
    return <p className="text-sm text-ink-faint">Nenhum item selecionado.</p>;
  }

  const precoPorId = new Map((itens ?? []).map((i) => [i.produtoId, i.precoUnit]));

  return (
    <div className="flex flex-wrap gap-2">
      {produtos.map((p) => {
        const preco = precoPorId.get(p.id) ?? p.precoEfetivo ?? p.precos[0]?.preco ?? 0;
        const extra = p.tipo === 'BEBIDA' && p.formato ? FORMATO_BEBIDA_LABELS[p.formato] : 'Comida';
        return (
          <span
            key={p.id}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink"
          >
            <span className="text-ink-muted font-medium">{extra}</span>
            {p.nome}
            <span className="text-brand-700">{formatCurrency(preco)}</span>
          </span>
        );
      })}
    </div>
  );
}
