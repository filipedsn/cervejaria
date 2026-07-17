interface ModalFormFooterProps {
  onCancel: () => void;
  submitLabel?: string;
  pending?: boolean;
  pendingLabel?: string;
  disabled?: boolean;
  cancelLabel?: string;
}

export function ModalFormFooter({
  onCancel,
  submitLabel = 'Salvar',
  pending = false,
  pendingLabel,
  disabled = false,
  cancelLabel = 'Voltar',
}: ModalFormFooterProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <button
        type="button"
        className="touch-btn-danger w-full min-h-14"
        disabled={pending}
        onClick={onCancel}
      >
        {cancelLabel}
      </button>
      <button
        type="submit"
        className="touch-btn-primary w-full min-h-14"
        disabled={pending || disabled}
      >
        {pending ? (pendingLabel ?? 'Salvando...') : submitLabel}
      </button>
    </div>
  );
}
