import { assetUrl } from '../lib/api';
import type { Cervejaria, Trailer, Usuario } from '../types';
import { formatTrailerLabel } from '../types';

const PAPEL_LABELS: Record<Usuario['papel'], string> = {
  DONO: 'Dono',
  ATENDENTE: 'Atendente',
  ADMIN: 'Admin',
};

function getInitials(nome: string) {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

interface AccountMenuProps {
  open: boolean;
  onClose: () => void;
  usuario: Usuario;
  cervejaria: Cervejaria | null;
  onLogout: () => void;
  trailer?: Trailer | null;
  onTrocarTrailer?: () => void;
}

export function AccountMenu({
  open,
  onClose,
  usuario,
  cervejaria,
  onLogout,
  trailer,
  onTrocarTrailer,
}: AccountMenuProps) {
  if (!open) return null;

  const logo = assetUrl(cervejaria?.logoUrl);
  const initials = getInitials(usuario.nome);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label="Conta"
        className="relative w-full max-w-lg bg-surface rounded-t-3xl sm:rounded-2xl border border-line safe-area-pb animate-slide-up shadow-xl"
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-line" aria-hidden />
        </div>

        <div className="px-4 pb-4 pt-2">
          <div className="flex items-center justify-between mb-4 px-1">
            <h2 className="text-lg font-bold text-ink">Conta</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="min-h-12 min-w-12 flex items-center justify-center text-2xl text-ink-muted rounded-xl active:bg-surface-lighter"
            >
              ×
            </button>
          </div>

          <div className="rounded-2xl bg-surface-lighter border border-line p-4 space-y-4">
            <div className="flex items-center gap-3">
              {logo ? (
                <img
                  src={logo}
                  alt=""
                  className="h-12 w-12 rounded-xl object-contain bg-surface border border-line shrink-0"
                />
              ) : (
                <div className="h-12 w-12 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center text-xl shrink-0">
                  🍺
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Cervejaria</p>
                <p className="text-lg font-bold truncate text-ink">{cervejaria?.nome ?? '—'}</p>
              </div>
            </div>

            <div className="border-t border-line pt-4 flex items-center gap-3">
              <div
                className="h-12 w-12 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center text-base font-bold text-brand-600 shrink-0"
                aria-hidden
              >
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold truncate text-ink">{usuario.nome}</p>
                <p className="text-sm text-ink-muted">{PAPEL_LABELS[usuario.papel]}</p>
              </div>
            </div>

            {trailer && (
              <div className="border-t border-line pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Trailer de trabalho</p>
                <p className="text-sm font-semibold text-ink mt-1">{formatTrailerLabel(trailer)}</p>
              </div>
            )}
          </div>

          {onTrocarTrailer && (
            <button type="button" onClick={onTrocarTrailer} className="touch-btn-secondary w-full mt-4">
              Trocar trailer
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="touch-btn-secondary w-full mt-4 text-danger border-danger/20 active:bg-danger-soft"
          >
            Sair da conta
          </button>
        </div>
      </div>
    </div>
  );
}

export function UserAvatarButton({ nome, onClick }: { nome: string; onClick: () => void }) {
  const initials = getInitials(nome);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Abrir conta"
      className="shrink-0 h-10 w-10 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center text-sm font-bold text-brand-600 active:scale-95 transition-transform"
    >
      {initials}
    </button>
  );
}
