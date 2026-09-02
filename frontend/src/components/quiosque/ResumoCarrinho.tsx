import { formatCurrency } from '../../lib/api';
import {
  limiteEstoqueCarrinho,
  podeIncrementarLinhaCarrinho,
  type LinhaCarrinho,
  type SaldoEstoque,
} from '../../lib/quiosque';

interface Props {
  linhas: LinhaCarrinho[];
  onAlterar: (produtoId: string, delta: number) => void;
  saldos?: Map<string, SaldoEstoque>;
  controlaEstoque?: boolean;
}

export function ResumoCarrinho({ linhas, onAlterar, saldos, controlaEstoque = false }: Props) {
  return (
    <div className="space-y-1">
      {linhas.map((linha) => {
        const limite = limiteEstoqueCarrinho(linha.produto, saldos, controlaEstoque);
        const podeIncrementar = podeIncrementarLinhaCarrinho(
          linha.produto,
          linha.quantidade,
          saldos,
          controlaEstoque,
        );

        return (
        <div key={linha.produto.id} className="flex items-center justify-between gap-3 py-1">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{linha.produto.nome}</span>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 shadow-sm">
              <button
                type="button"
                aria-label={`Remover um ${linha.produto.nome}`}
                className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-lg font-bold text-ink-muted transition-transform active:scale-95 active:bg-surface-lighter"
                onClick={() => onAlterar(linha.produto.id, -1)}
              >
                −
              </button>
              <span className="min-w-[2rem] text-center text-base font-bold tabular-nums">
                {linha.quantidade}
              </span>
              <button
                type="button"
                aria-label={`Adicionar um ${linha.produto.nome}`}
                className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-lg font-bold text-ink transition-transform active:scale-95 active:bg-surface-lighter disabled:opacity-40"
                disabled={!podeIncrementar}
                onClick={() => onAlterar(linha.produto.id, 1)}
              >
                +
              </button>
            </div>
            <span className="w-20 text-right text-sm font-semibold tabular-nums">
              {formatCurrency(Number(linha.produto.precoUnit) * linha.quantidade)}
            </span>
          </div>
          {limite !== null && (
            <span className="sr-only">
              Máximo {limite} unidade(s) em estoque
            </span>
          )}
        </div>
        );
      })}
    </div>
  );
}
