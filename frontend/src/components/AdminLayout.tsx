import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ConnectionStatus } from './ConnectionStatus';
import { AppLogo } from './AppLogo';

const navItems = [
  { path: '/admin/cervejarias', label: 'Cervejarias', icon: '🏭' },
  { path: '/admin/configuracoes', label: 'Configurações', icon: '⚙️' },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { usuario, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen flex bg-canvas">
      <ConnectionStatus trackSocket={false} />

      <aside className="hidden md:flex md:w-64 lg:w-72 shrink-0 flex-col border-r border-line bg-surface shadow-sm">
        <div className="px-3 py-6 border-b border-line flex justify-center items-center">
          <AppLogo className="w-full object-contain" />
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-muted hover:bg-surface-lighter hover:text-ink'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-line">
          <p className="text-sm font-medium truncate text-ink">{usuario?.nome}</p>
          <p className="text-xs text-ink-faint truncate mb-3">{usuario?.email}</p>
          <button onClick={logout} className="touch-btn-secondary w-full text-sm min-h-10">
            Sair
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 pb-20 md:pb-0">
        <header className="md:hidden sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-line px-4 py-3 flex items-center justify-between shadow-sm">
          <div>
            <h1 className="text-lg font-bold text-brand-600">Admin</h1>
            <p className="text-xs text-ink-muted truncate max-w-[200px]">{usuario?.nome}</p>
          </div>
          <button onClick={logout} className="text-sm text-ink-muted px-2">Sair</button>
        </header>

        <main className="flex-1 w-full px-4 sm:px-6 lg:px-10 py-6 lg:py-8">{children}</main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur border-t border-line px-2 py-2 z-40 safe-area-pb shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex justify-around gap-1">
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-0.5 px-4 py-2 rounded-xl min-w-[4.5rem] ${
                  active ? 'text-brand-600 bg-brand-50' : 'text-ink-muted'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
