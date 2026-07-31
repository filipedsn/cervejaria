import { formatCurrency } from '../../lib/api';
import type { LinhaCarrinho } from '../../lib/quiosque';

interface Props {
  linhas: LinhaCarrinho[];
  onAlterar: (produtoId: string, delta: number) => void;
}

export function ResumoCarrinho({ linhas, onAlterar }: Props) {
  return (
    <div className="space-y-1">
      {linhas.map((linha) => (
        <div key={linha.produto.id} className="flex items-center justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-sm">{linha.produto.nome}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label={`Remover um ${linha.produto.nome}`}
              className="touch-btn-ghost touch-btn-sm"
              onClick={() => onAlterar(linha.produto.id, -1)}
            >
              −
            </button>
            <span className="w-6 text-center font-semibold">{linha.quantidade}</span>
            <button
              type="button"
              aria-label={`Adicionar um ${linha.produto.nome}`}
              className="touch-btn-ghost touch-btn-sm"
              onClick={() => onAlterar(linha.produto.id, 1)}
            >
              +
            </button>
            <span className="w-20 text-right text-sm font-semibold">
              {formatCurrency(Number(linha.produto.precoUnit) * linha.quantidade)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
