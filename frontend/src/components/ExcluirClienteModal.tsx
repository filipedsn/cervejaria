import { Modal } from './Modal';

interface ExcluirClienteModalProps {
  open: boolean;
  clienteNome: string;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ExcluirClienteModal({
  open,
  clienteNome,
  pending = false,
  onClose,
  onConfirm,
}: ExcluirClienteModalProps) {
  return (
    <Modal
      open={open}
      onClose={() => !pending && onClose()}
      title="Excluir cliente?"
      footer={
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            className="touch-btn-secondary w-full min-h-14"
            disabled={pending}
            onClick={onClose}
          >
            Voltar
          </button>
          <button
            type="button"
            className="touch-btn-danger w-full min-h-14"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? 'Excluindo...' : 'Excluir cliente'}
          </button>
        </div>
      }
    >
      <p className="text-ink-soft leading-relaxed">
        O cliente &ldquo;{clienteNome}&rdquo; será removido permanentemente. Esta ação não pode ser
        desfeita.
      </p>
    </Modal>
  );
}
