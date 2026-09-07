import { Modal } from '../Modal';
import { GradeProdutos } from './GradeProdutos';
import { ResumoCarrinho } from './ResumoCarrinho';
import { formatCurrency } from '../../lib/api';
import { totalCarrinho, type LinhaCarrinho, type ProdutoQuiosque, type SaldoEstoque } from '../../lib/quiosque';

export function AdicionarItensQuiosqueModal({
  open,
  onClose,
  produtos,
  linhas,
  onSelecionar,
  onAlterar,
  onConfirm,
  isPending,
  error,
  successMessage,
  saldos,
  controlaEstoque,
  confirmLabel = 'Adicionar itens',
}: {
  open: boolean;
  onClose: () => void;
  produtos: ProdutoQuiosque[];
  linhas: LinhaCarrinho[];
  onSelecionar: (produto: ProdutoQuiosque) => void;
  onAlterar: (produtoId: string, delta: number) => void;
  onConfirm: () => void;
  isPending: boolean;
  error?: string;
  successMessage?: string;
  saldos?: Map<string, SaldoEstoque>;
  controlaEstoque: boolean;
  confirmLabel?: string;
}) {
  const quantidades = new Map(linhas.map((linha) => [linha.produto.id, linha.quantidade]));
  const footer = (
    <>
      {linhas.length > 0 && (
        <div className="space-y-3">
          <div className="max-h-32 overflow-y-auto -mx-1 px-1">
            <ResumoCarrinho
              linhas={linhas}
              onAlterar={onAlterar}
              saldos={saldos}
              controlaEstoque={controlaEstoque}
            />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-faint">Itens selecionados</span>
            <span className="text-xl font-bold tabular-nums">{formatCurrency(totalCarrinho(linhas))}</span>
          </div>
        </div>
      )}
      <button
        type="button"
        className="touch-btn-primary w-full"
        disabled={linhas.length === 0 || isPending}
        onClick={onConfirm}
      >
        {isPending ? 'Salvando...' : confirmLabel}
      </button>
      <button type="button" className="touch-btn-secondary w-full" onClick={onClose} disabled={isPending}>
        Voltar
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Adicionar item" hideHeaderClose footer={footer}>
      <div className="space-y-4">
        {error && <div className="alert-error text-sm">{error}</div>}
        {successMessage && <div className="alert-success text-sm" role="status">{successMessage}</div>}
        <GradeProdutos
          produtos={produtos}
          onSelecionar={onSelecionar}
          saldos={saldos}
          controlaEstoque={controlaEstoque}
          quantidadesNoCarrinho={quantidades}
        />
      </div>
    </Modal>
  );
}
