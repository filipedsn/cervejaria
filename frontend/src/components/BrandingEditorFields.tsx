import { useMemo } from 'react';
import { assetUrl } from '../lib/api';
import { buildTheme, PALETTE_SHADES, normalizeTheme } from '../lib/brand-colors';
import type { BrandTheme } from '../types';

const DEFAULT_PRIMARY = '#e69500';

interface BrandingEditorFieldsProps {
  currentLogoUrl?: string | null;
  newLogoPreview?: string | null;
  onLogoSelect: (file: File | null) => void;
  corPrimaria: string;
  onCorPrimariaChange: (color: string) => void;
  savedTheme?: BrandTheme | null;
  onReextract?: () => void;
  reextractPending?: boolean;
  disabled?: boolean;
  logoLabel?: string;
}

export function BrandingEditorFields({
  currentLogoUrl,
  newLogoPreview,
  onLogoSelect,
  corPrimaria,
  onCorPrimariaChange,
  savedTheme,
  onReextract,
  reextractPending,
  disabled,
  logoLabel = 'Trocar logo',
}: BrandingEditorFieldsProps) {
  const displayLogo = newLogoPreview ?? assetUrl(currentLogoUrl ?? null);
  const previewTheme = useMemo(
    () => buildTheme(corPrimaria, savedTheme?.corSecundaria ?? null, savedTheme?.surface.base),
    [corPrimaria, savedTheme],
  );

  return (
    <div className="space-y-4">
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
            {currentLogoUrl && onReextract && (
              <button
                type="button"
                className="block text-sm text-brand-600 hover:text-brand-500 disabled:opacity-50"
                disabled={disabled || reextractPending}
                onClick={onReextract}
              >
                {reextractPending ? 'Analisando logo...' : 'Reanalisar identidade visual'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card space-y-4 !p-4">
        <h3 className="font-semibold text-sm">Cor principal</h3>
        <p className="text-sm text-ink-muted">
          Ajuste o destaque. Fundo e paleta são recalculados automaticamente.
        </p>

        <div className="flex items-center gap-4">
          <input
            type="color"
            value={corPrimaria || DEFAULT_PRIMARY}
            onChange={(e) => onCorPrimariaChange(e.target.value)}
            className="h-14 w-14 rounded-xl cursor-pointer bg-transparent border border-line shrink-0"
            disabled={disabled}
          />
          <input
            type="text"
            value={corPrimaria}
            onChange={(e) => {
              const v = e.target.value;
              if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onCorPrimariaChange(v);
            }}
            className="input flex-1 font-mono uppercase"
            maxLength={7}
            disabled={disabled}
          />
        </div>

        {previewTheme.corSecundaria && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-muted">Acento secundário:</span>
            <span
              className="inline-block w-6 h-6 rounded-md border border-line"
              style={{ backgroundColor: previewTheme.corSecundaria }}
            />
            <span className="font-mono text-ink-soft">{previewTheme.corSecundaria}</span>
          </div>
        )}

        <div>
          <p className="text-xs text-ink-faint uppercase tracking-wide mb-2">Fundos do app</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['Base', previewTheme.surface.base],
              ['Cards', previewTheme.surface.light],
              ['Inputs', previewTheme.surface.lighter],
            ] as const).map(([label, color]) => (
              <div key={label} className="text-center">
                <div className="h-12 rounded-lg border border-line" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-ink-faint mt-1 block">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-ink-faint uppercase tracking-wide mb-2">Paleta de destaques</p>
          <div className="grid grid-cols-5 gap-2">
            {PALETTE_SHADES.map((shade) => (
              <div key={shade} className="text-center">
                <div
                  className="h-10 rounded-lg border border-line"
                  style={{ backgroundColor: previewTheme.brand[shade] }}
                />
                <span className="text-[10px] text-ink-faint mt-1 block">{shade}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_PRIMARY as BRANDING_DEFAULT_PRIMARY };
export { normalizeTheme };
