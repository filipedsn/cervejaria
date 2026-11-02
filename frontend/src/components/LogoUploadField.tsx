import { assetUrl } from '../lib/api';

interface LogoUploadFieldProps {
  currentLogoUrl?: string | null;
  newLogoPreview?: string | null;
  onLogoSelect: (file: File | null) => void;
  disabled?: boolean;
  logoLabel?: string;
}

export function LogoUploadField({
  currentLogoUrl,
  newLogoPreview,
  onLogoSelect,
  disabled,
  logoLabel = 'Trocar logo',
}: LogoUploadFieldProps) {
  const displayLogo = newLogoPreview ?? assetUrl(currentLogoUrl ?? null);

  return (
    <div className="card space-y-4 !p-4">
      <h3 className="font-semibold text-sm">Logomarca</h3>
      <div className="flex items-center gap-4">
        {displayLogo ? (
          <img
            src={displayLogo}
            alt="Logo"
            className="h-20 w-20 rounded-xl object-contain bg-surface-lighter border border-line shrink-0"
          />
        ) : (
          <div className="h-20 w-20 rounded-xl bg-surface-lighter border border-line flex items-center justify-center text-ink-faint text-xs text-center px-2 shrink-0">
            Sem logo
          </div>
        )}
        <div className="flex-1 space-y-2 min-w-0">
          <label className="touch-btn-secondary touch-btn-sm inline-block cursor-pointer">
            {logoLabel}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              disabled={disabled}
              onChange={(e) => {
                onLogoSelect(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </label>
          {newLogoPreview && (
            <button
              type="button"
              className="block text-sm text-ink-muted hover:text-ink"
              disabled={disabled}
              onClick={() => onLogoSelect(null)}
            >
              Descartar nova imagem
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
