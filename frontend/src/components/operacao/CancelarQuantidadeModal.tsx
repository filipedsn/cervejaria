import { useEffect, useState } from 'react';
import { Modal } from '../Modal';

interface Props {
  open: boolean;
  nomeItem: string;
  quantidadeDisponivel: number;
  disabled?: boolean;
  erro?: string | null;
  onClose: () => void;
  onConfirmar: (quantidade: number) => void;
}

export function CancelarQuantidadeModal({
  open,
  nomeItem,
  quantidadeDisponivel,
  disabled = false,
  erro = null,
  onClose,
  onConfirmar,
}: Props) {
  const [quantidade, setQuantidade] = useState('1');
  const quantidadeNumerica = Number(quantidade);
  const quantidadeValida = Number.isInteger(quantidadeNumerica) &&
    quantidadeNumerica >= 1 && quantidadeNumerica <= quantidadeDisponivel;

  useEffect(() => {
    if (open) setQuantidade('1');
  }, [open, quantidadeDisponivel]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quantos itens deseja cancelar?"
      closeOnBackdrop={!disabled}
      footer={(
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" className="touch-btn-ghost w-full" disabled={disabled} onClick={onClose}>
            Voltar
          </button>
          <button
            type="button"
            className="touch-btn-danger w-full"
            disabled={disabled || !quantidadeValida}
            onClick={() => onConfirmar(quantidadeNumerica)}
          >
            Confirmar cancelamento
          </button>
        </div>
      )}
    >
      <div className="space-y-3">
        {erro && <p role="alert" className="alert-error">{erro}</p>}
        <p className="font-semibold">{nomeItem}</p>
        <p className="text-sm text-ink-muted">
          Restarão {quantidadeDisponivel - (quantidadeValida ? quantidadeNumerica : 0)} de {quantidadeDisponivel} unidades.
        </p>
        <label className="block space-y-1 text-sm font-semibold">
          <span>Quantidade a cancelar (máximo {quantidadeDisponivel})</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={quantidadeDisponivel}
            step={1}
            className="input w-full"
            value={quantidade}
            disabled={disabled}
            onChange={(event) => setQuantidade(event.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
