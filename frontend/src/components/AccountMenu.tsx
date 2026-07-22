import { assetUrl } from '../lib/api';
import type { Cervejaria, Trailer, Usuario } from '../types';
import { formatTrailerLabel } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { IconBell } from './NavIcons';
import { SettingsRow, ThemeSegmentedControl } from './SettingsRow';
import type { PedidoPushStatus } from '../hooks/usePedidoAlertSound';

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
  alertEnabled?: boolean;
  alertNeedsUnlock?: boolean;
  pushStatus?: PedidoPushStatus;
  wakeLockActive?: boolean;
  onTogglePedidoAlert?: () => void;
}

function alertStatusText(
  alertEnabled: boolean,
  alertNeedsUnlock: boolean,
  pushStatus: PedidoPushStatus,
  wakeLockActive: boolean,
): string {
  if (!alertEnabled) {
    return 'Toque na campainha para ativar som, vibração e notificações push';
  }
  if (alertNeedsUnlock) {
    return 'Toque na campainha ou em qualquer lugar da tela para reativar o som';
  }
  if (pushStatus === 'denied') {
    return 'Som e tela ligada ativos; permita notificações nas configurações do celular';
  }
  if (pushStatus === 'unsupported' || pushStatus === 'disabled') {
    return wakeLockActive
      ? 'Som, vibração e tela ligada ativos durante o evento'
      : 'Som e vibração ativos para novos pedidos';
  }
  return wakeLockActive
    ? 'Som, push, vibração e tela ligada ativos durante o evento'
    : 'Som, push e vibração ativos para novos pedidos';
}

export function AccountMenu({
  open,
  onClose,
  usuario,
  cervejaria,
  onLogout,
  trailer,
  onTrocarTrailer,
  alertEnabled = false,
  alertNeedsUnlock = false,
  pushStatus = 'unknown',
  wakeLockActive = false,
  onTogglePedidoAlert,
}: AccountMenuProps) {
  const { theme, setTheme } = useTheme();

  if (!open) return null;

  const logo = assetUrl(cervejaria?.logoUrl);
  const initials = getInitials(usuario.nome);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="overlay-backdrop" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label="Conta"
        className="relative w-full max-w-lg bg-surface rounded-t-3xl sm:rounded-2xl border border-line safe-area-pb animate-slide-up shadow-xl"
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-line-soft" aria-hidden />
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

          <div className="settings-card p-4 space-y-4 mb-4">
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

          <div className="mb-4">
            <p className="section-label px-1 mb-2">Preferências</p>
            <div className="settings-card">
              {onTogglePedidoAlert && (
                <SettingsRow
                  title="Alertas de pedidos"
                  description={alertStatusText(alertEnabled, alertNeedsUnlock, pushStatus, wakeLockActive)}
                  control={
                    <button
                      type="button"
                      onClick={() => void onTogglePedidoAlert()}
                      aria-label={
                        !alertEnabled
                          ? 'Ativar alertas de pedidos'
                          : alertNeedsUnlock
                            ? 'Liberar som dos alertas de pedidos'
                            : 'Desativar alertas de pedidos'
                      }
                      aria-pressed={alertEnabled}
                      className={`min-h-12 min-w-12 flex items-center justify-center rounded-xl shrink-0 transition-colors active:scale-95 ${
                        !alertEnabled
                          ? 'bg-surface border border-line text-ink-muted'
                          : alertNeedsUnlock
                            ? 'alert-warn-btn'
                            : 'alert-active-btn'
                      }`}
                    >
                      <IconBell className="w-6 h-6" strokeWidth={alertEnabled ? 2.25 : 1.75} />
                    </button>
                  }
                />
              )}

              <SettingsRow
                stacked
                title="Aparência"
                description="Salvo neste dispositivo"
                control={<ThemeSegmentedControl value={theme} onChange={setTheme} />}
              />
            </div>
          </div>

          {onTrocarTrailer && (
            <button type="button" onClick={onTrocarTrailer} className="touch-btn-secondary w-full">
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
      className="h-10 w-10 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center text-sm font-bold text-brand-600 shrink-0 active:scale-95 transition-transform"
    >
      {initials}
    </button>
  );
}
