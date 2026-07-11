function ToggleAtivo({
  ativo,
  loading,
  onToggle,
}: {
  ativo: boolean;
  loading?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        ativo ? 'bg-success' : 'bg-surface-lighter border border-line'
      }`}
      title={ativo ? 'Desativar cervejaria' : 'Ativar cervejaria'}
      aria-label={ativo ? 'Desativar cervejaria' : 'Ativar cervejaria'}
    >
      <span
        className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
          ativo ? 'translate-x-7' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export { ToggleAtivo };
