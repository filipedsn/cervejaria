import { useState } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEvento } from '../contexts/EventoContext';
import { assetUrl, formatEventoWhen } from '../lib/api';
import type { Evento, Trailer } from '../types';
import { formatTrailerLabel } from '../types';
import { ConnectionStatus } from './ConnectionStatus';
import { AccountMenu, UserAvatarButton } from './AccountMenu';
import { BackToEventosLink } from './BackToEventosLink';
import { PortalQrButton } from './PortalQrButton';
import { TrailerSwitcher } from './TrailerSwitcher';
import { NAV_ITEMS, IconBell } from './NavIcons';
import { usePedidoAlertSound } from '../hooks/usePedidoAlertSound';

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LiveBadge() {
  return (
    <span className="badge-live shrink-0 inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
      Ao vivo
    </span>
  );
}

function EventoInfo({ evento }: { evento: Evento }) {
  return (
    <div className="flex flex-1 items-center gap-2 min-w-0 px-3 py-2.5 overflow-hidden">
      {evento.status === 'ABERTO' && <LiveBadge />}
      <p className="min-w-0 flex-1 truncate text-sm leading-snug">
        <span className="font-bold text-ink">{evento.nome}</span>
        <span className="text-ink-faint mx-1.5">·</span>
        <span className="text-ink-muted font-medium">{evento.local}</span>
        <span className="text-ink-faint mx-1.5">·</span>
        <span className="text-ink-muted">{formatEventoWhen(evento)}</span>
      </p>
    </div>
  );
}

function EventoBar({
  evento,
  trailer,
  onEventsPage,
  hideOnPage,
}: {
  evento: Evento | null;
  trailer: Trailer | null;
  onEventsPage: boolean;
  hideOnPage: boolean;
}) {
  if (hideOnPage || (onEventsPage && !evento)) return null;

  if (!evento) {
    return (
      <div className="flex items-stretch min-h-14 rounded-xl overflow-hidden border border-line bg-surface shadow-sm">
        <div className="flex flex-1 items-center min-w-0 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {trailer ? 'Nenhum evento aberto neste trailer' : 'Nenhum evento selecionado'}
            </p>
            <p className="text-xs text-ink-muted mt-0.5">
              {trailer
                ? `${formatTrailerLabel(trailer)} — inicie ou retome um evento`
                : 'Escolha ou crie um evento para continuar'}
            </p>
          </div>
        </div>
        <Link
          to="/eventos"
          aria-label="Ir para lista de eventos"
          className="touch-btn-danger touch-btn-sm flex shrink-0 items-center gap-1.5 px-4 min-w-[5.5rem] rounded-none border-0 border-l border-line uppercase tracking-wide leading-none"
        >
          <span className="text-xs font-bold uppercase tracking-wide leading-none">Eventos</span>
          <ChevronRightIcon className="w-5 h-5 shrink-0" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-stretch min-h-14 rounded-xl overflow-hidden border border-line bg-surface shadow-sm">
      <BackToEventosLink className="shrink-0 min-w-[5.5rem] rounded-none border-0 border-r border-line" />
      <EventoInfo evento={evento} />
      {evento.status === 'ABERTO' && (
        <PortalQrButton
          trailerId={evento.trailerId}
          trailer={evento.trailer ?? trailer}
          iconOnly
          variant="header"
        />
      )}
    </div>
  );
}

function isNavActive(path: string, current: string, exact?: boolean) {
  if (path === '/configuracoes') return current.startsWith('/configuracoes');
  if (path === '/clientes') return current.startsWith('/clientes');
  if (exact) return current === path;
  return current.startsWith(path);
}

export function Layout() {
  const { usuario, cervejaria, logout, isDono } = useAuth();
  const { evento, trailer, trailers, clearTrailer } = useEvento();
  const location = useLocation();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);

  const navItems = NAV_ITEMS.filter((item) => !('donoOnly' in item && item.donoOnly) || isDono);
  const { alertEnabled, alertNeedsUnlock, pushStatus, wakeLockActive, togglePedidoAlert } =
    usePedidoAlertSound();
  const onEventsPage = location.pathname === '/eventos';
  const onTrailerPage = location.pathname === '/trailer';
  const hideOperacionalChrome =
    onEventsPage ||
    onTrailerPage ||
    location.pathname === '/dashboard' ||
    location.pathname.startsWith('/clientes') ||
    location.pathname.startsWith('/configuracoes') ||
    /^\/eventos\/[^/]+\/resumo$/.test(location.pathname);
  const showTrailerSwitcher = trailers.length > 1 && !hideOperacionalChrome;

  function handleTrocarTrailer() {
    if (!confirm('Trocar de trailer? Você precisará escolher novamente onde trabalhar.')) return;
    clearTrailer();
    setAccountOpen(false);
    navigate('/trailer');
  }

  return (
    <div className="min-h-screen flex flex-col pb-nav bg-canvas">
      <ConnectionStatus />

      <header className="app-shell-header safe-area-pt">
        <div className={`w-full max-w-6xl mx-auto ${onEventsPage || onTrailerPage ? 'px-4 py-3' : 'px-4 py-2 space-y-2'}`}>
          {onEventsPage || onTrailerPage ? (
            <div className="flex items-center justify-between gap-3 min-h-10">
              <h1 className="text-xl font-bold text-ink">
                {onTrailerPage ? 'Escolher trailer' : 'Eventos'}
              </h1>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={`icon-btn-ghost ${alertEnabled ? 'text-orange' : 'text-ink-muted'}`}
                  aria-label={alertEnabled ? 'Alertas de pedidos ativos' : 'Abrir alertas de pedidos'}
                  onClick={() => setAccountOpen(true)}
                >
                  <IconBell strokeWidth={alertEnabled ? 2.25 : 1.75} />
                </button>
                {usuario && <UserAvatarButton nome={usuario.nome} onClick={() => setAccountOpen(true)} />}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 min-h-10">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {assetUrl(cervejaria?.logoUrl) ? (
                    <img
                      src={assetUrl(cervejaria?.logoUrl)!}
                      alt={cervejaria?.nome ?? 'Logo da cervejaria'}
                      data-brewery-branding
                      className="h-8 w-8 rounded-lg object-contain bg-surface-lighter border border-line shrink-0"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-sm shrink-0">
                      🍺
                    </div>
                  )}
                  <p className="text-base font-bold text-ink truncate leading-tight">{cervejaria?.nome}</p>
                </div>
                {usuario && <UserAvatarButton nome={usuario.nome} onClick={() => setAccountOpen(true)} />}
              </div>
              {showTrailerSwitcher && <TrailerSwitcher />}
              <EventoBar
                evento={evento}
                trailer={trailer}
                onEventsPage={onEventsPage}
                hideOnPage={hideOperacionalChrome}
              />
            </>
          )}
        </div>
      </header>

      <main
        className={`flex-1 w-full max-w-6xl mx-auto ${
          onEventsPage || onTrailerPage ? 'px-4 py-4' : 'px-4 py-3 sm:px-6 sm:py-5'
        }`}
      >
        <Outlet />
      </main>

      <nav
        aria-label="Navegação principal"
        className="app-bottom-nav safe-area-pb"
        style={{ height: 'calc(var(--bottom-nav-height) + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-stretch justify-around w-full max-w-6xl mx-auto h-[var(--bottom-nav-height)] px-1">
          {navItems.map((item) => {
            const active = isNavActive(item.path, location.pathname, item.exact);
            const { Icon } = item;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-1 flex-col items-center justify-center gap-1 min-w-0 py-1.5 transition-colors ${
                  active ? 'text-brand-600' : 'text-ink-faint'
                }`}
              >
                <Icon className="w-6 h-6" strokeWidth={active ? 2 : 1.75} />
                <span className="text-[11px] font-semibold leading-none">{item.shortLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {usuario && (
        <AccountMenu
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          usuario={usuario}
          cervejaria={cervejaria}
          onLogout={logout}
          trailer={trailers.length > 1 ? trailer : null}
          onTrocarTrailer={trailers.length > 1 && !isDono ? handleTrocarTrailer : undefined}
          alertEnabled={alertEnabled}
          alertNeedsUnlock={alertNeedsUnlock}
          pushStatus={pushStatus}
          wakeLockActive={wakeLockActive}
          onTogglePedidoAlert={togglePedidoAlert}
        />
      )}
    </div>
  );
}
