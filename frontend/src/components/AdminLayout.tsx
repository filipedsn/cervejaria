import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ConnectionStatus } from './ConnectionStatus';
import { AppLogo } from './AppLogo';
import { ThemeSegmentedControl } from './SettingsRow';

const navItems = [
  { path: '/admin/cervejarias', label: 'Empresas', icon: '🏭' },
  { path: '/admin/configuracoes', label: 'Configurações', icon: '⚙️' },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { usuario, logout } = useAuth();
  const { theme, setTheme } = useTheme();
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

        <div className="p-4 border-t border-line space-y-3">
          <div>
            <p className="section-label mb-2">Aparência</p>
            <ThemeSegmentedControl value={theme} onChange={setTheme} />
          </div>
          <p className="text-sm font-medium truncate text-ink">{usuario?.nome}</p>
          <p className="text-xs text-ink-faint truncate mb-3">{usuario?.email}</p>
          <button onClick={logout} className="touch-btn-secondary w-full text-sm min-h-10">
            Sair
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 pb-20 md:pb-0">
        <header className="app-shell-header md:hidden px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-brand-600">Admin</h1>
            <p className="text-xs text-ink-muted truncate max-w-[200px]">{usuario?.nome}</p>
          </div>
          <button onClick={logout} className="text-sm text-ink-muted px-2">Sair</button>
        </header>

        <main className="flex-1 w-full px-4 sm:px-6 lg:px-10 py-6 lg:py-8">{children}</main>
      </div>

      <nav className="md:hidden app-bottom-nav px-2 py-2 safe-area-pb">
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
