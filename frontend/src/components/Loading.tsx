export function Loading({ fullScreen }: { fullScreen?: boolean }) {
  return (
    <div className={fullScreen ? 'min-h-screen flex items-center justify-center bg-canvas' : 'flex items-center justify-center p-8'}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-ink-muted">Carregando...</span>
      </div>
    </div>
  );
}
