import type { CardapioOperacaoItem, ProdutoOperacao } from '../../lib/operacao';
import { formatCurrency } from '../../lib/api';
import { isChopeOperacao, normalizeCategoriaProduto } from '../../lib/operacao';
import { CurrencyInput } from '../CurrencyInput';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../../lib/currency';
import { FOOD_UNIT_ML } from '../../types';



export type ProdutoCardapioPicker = {
  id: string;
  nome: string;
  categoria?: string | null;
  tipo?: 'BEBIDA' | 'COMIDA';
  formato?: ProdutoOperacao['formato'];
  precos?: Array<{ volumeMl: number; preco: number | string }>;
  volumeMl?: number;
  precoUnit?: string | number;
  precoEfetivo?: number;
};

function groupCatalogo(catalogo: ProdutoCardapioPicker[], incluirVolumesChope = false) {

  const grupos = new Map<string, ProdutoCardapioPicker[]>();

  for (const produto of catalogo) {

    const cat = normalizeCategoriaProduto(produto.categoria);

    const lista = grupos.get(cat) ?? [];

    if (incluirVolumesChope && (isChopeOperacao({ ...produto, categoria: produto.categoria ?? null }) || produto.formato === 'CHOPE')) {
      for (const preco of (produto.precos ?? []).filter((item) => item.volumeMl > FOOD_UNIT_ML)) {
        lista.push({ ...produto, volumeMl: preco.volumeMl, precoUnit: String(preco.preco), precoEfetivo: Number(preco.preco) });
      }
    } else {
      lista.push(produto);
    }

    grupos.set(cat, lista);

  }

  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));

}



function defaultPrecoCatalogo(produto: ProdutoCardapioPicker): number {

  if (isChopeOperacao({ ...produto, categoria: produto.categoria ?? null }) || produto.formato === 'CHOPE' || (produto.volumeMl ?? 0) > FOOD_UNIT_ML) {
    const precoVariante = produto.volumeMl
      ? produto.precos?.find((preco) => preco.volumeMl === produto.volumeMl)?.preco
      : undefined;
    if (Number(precoVariante) > 0) return Number(precoVariante);
    const precoPorVolume = [...(produto.precos ?? [])]
      .filter((preco) => preco.volumeMl > FOOD_UNIT_ML)
      .sort((a, b) => a.volumeMl - b.volumeMl)[0]?.preco;
    if (Number(precoPorVolume) > 0) return Number(precoPorVolume);
  }

  const precoUnit = Number(produto.precoUnit ?? produto.precoEfetivo);
  if (Number.isFinite(precoUnit) && precoUnit > 0) return precoUnit;

  const precoPadrao = produto.precos?.find((preco) => preco.volumeMl === FOOD_UNIT_ML)?.preco ?? produto.precos?.[0]?.preco;
  return Number(precoPadrao) || 0;

}



type TemplatePickerProps = {

  catalogo: ProdutoCardapioPicker[];

  itens: CardapioOperacaoItem[];

  onToggle: (produtoId: string, volumeMl: number, defaultPreco: number) => void;

  onPrecoChange: (produtoId: string, volumeMl: number, precoUnit: number) => void;

  selectedIds?: never;

};



type SelectionPickerProps = {

  catalogo: ProdutoCardapioPicker[];

  selectedIds: string[];

  onToggle: (produtoId: string) => void;

  itens?: never;

  onPrecoChange?: never;

};



export function CardapioOperacaoProdutosPicker(props: TemplatePickerProps | SelectionPickerProps) {

  const { catalogo } = props;

  const isTemplateMode = 'itens' in props && props.itens !== undefined;

  const precoPorId = isTemplateMode

    ? new Map(props.itens.map((i) => [`${i.produtoId}:${i.volumeMl ?? 0}`, i.precoUnit]))

    : null;

  const selectedSet = isTemplateMode ? precoPorId! : new Set(props.selectedIds);



  const grupos = groupCatalogo(catalogo, isTemplateMode);



  const renderGroup = (titulo: string, items: ProdutoCardapioPicker[]) => {

    if (items.length === 0) return null;

    return (

      <div className="space-y-2">

        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">{titulo}</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">

          {items.map((p) => {

            const volumeMl = p.volumeMl ?? 0;
            const itemKey = `${p.id}:${volumeMl}`;
            const checked = isTemplateMode ? precoPorId!.has(itemKey) : selectedSet.has(p.id);

            const catalogoPreco = defaultPrecoCatalogo(p);

            return (

              <div

                key={itemKey}

                className={[

                  'rounded-xl border-2 p-2.5 transition-colors min-w-0',

                  checked ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface',

                ].join(' ')}

              >

                <label className="flex items-start gap-2 cursor-pointer">

                  <input

                    type="checkbox"

                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"

                    checked={checked}

                    onChange={() => {

                      if (isTemplateMode) {

                        props.onToggle(p.id, volumeMl, catalogoPreco);

                      } else {

                        props.onToggle(p.id);

                      }

                    }}

                  />

                  <span className="min-w-0 flex-1">

                    <span className="block text-sm font-semibold text-ink leading-tight">{p.nome}{volumeMl > FOOD_UNIT_ML ? ` (${volumeMl} ml)` : ''}</span>

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
                      value={formatCurrencyInputFromNumber(precoPorId!.get(itemKey) ?? catalogoPreco)}
                      onChange={(value) => {
                        const val = parseCurrencyInput(value);
                        if (val > 0) props.onPrecoChange(p.id, volumeMl, val);
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

        Cadastre produtos no catálogo do operacao primeiro.

      </p>

    );

  }



  return (

    <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">

      {grupos.map(([titulo, items]) => renderGroup(titulo, items))}

    </div>

  );

}



export function CardapioOperacaoProdutosResumo({

  produtos,

  itens,

}: {

  produtos: ProdutoOperacao[];

  itens?: CardapioOperacaoItem[];

}) {

  if (produtos.length === 0) {

    return <p className="text-sm text-ink-faint">Nenhum item selecionado.</p>;

  }



  const precoPorId = new Map((itens ?? []).map((i) => [`${i.produtoId}:${i.volumeMl ?? 0}`, i.precoUnit]));



  return (

    <div className="flex flex-wrap gap-2">

      {produtos.map((p) => {

        const preco = precoPorId.get(`${p.id}:${p.volumeMl ?? 0}`) ?? p.precoEfetivo ?? (parseFloat(p.precoUnit) || 0);

        return (

          <span

            key={`${p.id}:${p.volumeMl ?? 0}`}

            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink"

          >

            <span className="text-ink-muted font-medium">

              {normalizeCategoriaProduto(p.categoria)}

            </span>

            {p.nome}
            {(p.volumeMl ?? 0) > FOOD_UNIT_ML ? ` · ${p.volumeMl} ml` : ''}

            <span className="text-brand-700">{formatCurrency(preco)}</span>

          </span>

        );

      })}

    </div>

  );

}

