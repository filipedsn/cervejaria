import { formatCurrency } from '../../lib/api';
import {
  limiteEstoqueCarrinho,
  podeIncrementarLinhaCarrinho,
  type LinhaCarrinho,
  type SaldoEstoque,
  isChopeOperacao,
} from '../../lib/operacao';

interface Props {
  linhas: LinhaCarrinho[];
  onAlterar: (produtoId: string, delta: number, tapId?: string, volumeMl?: number) => void;
  saldos?: Map<string, SaldoEstoque>;
  controlaEstoque?: boolean;
}

export function ResumoCarrinho({ linhas, onAlterar, saldos, controlaEstoque = false }: Props) {
  return (
    <div className="space-y-1">
      {linhas.map((linha) => {
        const limite = limiteEstoqueCarrinho(linha.produto, saldos, controlaEstoque);
        const chope = isChopeOperacao(linha.produto);
        const saldo = saldos?.get(linha.produto.id);
        const consumoAtual = chope
          ? linhas.filter((item) => item.produto.id === linha.produto.id).reduce((soma, item) => soma + ((item.volumeMl ?? 0) * item.quantidade) / 1000, 0)
          : 0;
        const podeIncrementar = chope && controlaEstoque && linha.produto.controlaEstoque && saldo
          ? saldo.quantidade - consumoAtual >= ((linha.volumeMl ?? 0) / 1000)
          : podeIncrementarLinhaCarrinho(linha.produto, linha.quantidade, saldos, controlaEstoque);

        return (
        <div key={`${linha.produto.id}-${linha.tapId ?? 'unit'}-${linha.volumeMl ?? 0}`} className="flex items-center justify-between gap-3 py-1">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{linha.produto.nome}{linha.volumeMl ? ` · ${linha.volumeMl} ml` : ''}</span>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 shadow-sm">
              <button
                type="button"
                aria-label={`Remover um ${linha.produto.nome}`}
                className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-lg font-bold text-ink-muted transition-transform active:scale-95 active:bg-surface-lighter"
                onClick={() => onAlterar(linha.produto.id, -1, linha.tapId, linha.volumeMl)}
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
                onClick={() => onAlterar(linha.produto.id, 1, linha.tapId, linha.volumeMl)}
              >
                +
              </button>
            </div>
            <span className="w-20 text-right text-sm font-semibold tabular-nums">
              {formatCurrency((linha.precoUnit ?? Number(linha.produto.precoUnit)) * linha.quantidade)}
            </span>
          </div>
          {limite !== null && (
            <span className="sr-only">
              Máximo {limite} {saldo?.unidadeEstoque ?? 'un'} em estoque
            </span>
          )}
        </div>
        );
      })}
    </div>
  );
}
