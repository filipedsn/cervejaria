import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Usuario, Cervejaria, AuthResponse } from '../types';
import { api } from '../lib/api';
import { clearSessionQueryCache } from '../lib/query-client';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { resetBreweryTheme, syncBreweryTheme } from '../lib/theme';
import { ensureAppShellBranding } from '../lib/app-branding';
import { isPublicPath, setUnauthorizedHandler } from '../lib/auth-session';
import { flushPendingAuditAfterAuth } from '../lib/audit-tracker';

interface AuthContextType {
  usuario: Usuario | null;
  cervejaria: Cervejaria | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, senha: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  updateCervejaria: (cervejaria: Cervejaria) => void;
  isDono: boolean;
  isAdmin: boolean;
  podeDarDescontoOperacao: boolean;
  hasPermission: (permission: string) => boolean;
  canPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cervejaria, setCervejaria] = useState<Cervejaria | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const authInitializationStarted = useRef(false);

  const applyAuth = useCallback((data: AuthResponse) => {
    clearSessionQueryCache();
    resetBreweryTheme();
    setUsuario(data.usuario);
    setCervejaria(data.cervejaria);
    syncBreweryTheme(data.usuario, data.cervejaria);
    ensureAppShellBranding();
    if (data.cervejaria) {
      connectSocket(data.cervejaria.id);
    }
  }, []);

  const logout = useCallback(async () => {
    clearSessionQueryCache();
    resetBreweryTheme();
    ensureAppShellBranding();
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* cookie cleared client-side anyway */
    }
    localStorage.removeItem('eventoAtivo');
    localStorage.removeItem('trailerAtivo');
    setUsuario(null);
    setCervejaria(null);
    disconnectSocket();
  }, []);

  const updateCervejaria = useCallback((updated: Cervejaria) => {
    setCervejaria(updated);
    setUsuario((current) => {
      syncBreweryTheme(current, updated);
      ensureAppShellBranding();
      return current;
    });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      await logout();
      if (typeof window !== 'undefined' && !isPublicPath(window.location.pathname)) {
        window.location.href = '/login';
      }
    });
    return () => setUnauthorizedHandler(() => {});
  }, [logout]);

  useEffect(() => {
    // StrictMode replays effects in development. A second /auth/me response
    // would clear active tenant queries after the authenticated UI mounts.
    if (authInitializationStarted.current) return;
    authInitializationStarted.current = true;

    // The customer portal is public and uses its own customer session. An
    // anonymous /auth/me 401 triggers the staff logout handler, which clears
    // React Query while the portal's public information query is loading.
    if (window.location.pathname.startsWith('/c/')) {
      setIsLoading(false);
      return;
    }

    api
      .get<{ usuario: Usuario; cervejaria: Cervejaria | null }>('/api/auth/me')
      .then((data) => {
        clearSessionQueryCache();
        resetBreweryTheme();
        setUsuario(data.usuario);
        setCervejaria(data.cervejaria);
        syncBreweryTheme(data.usuario, data.cervejaria);
        ensureAppShellBranding();
        if (data.cervejaria) {
          connectSocket(data.cervejaria.id);
        }
        flushPendingAuditAfterAuth();
      })
      .catch(() => {
        clearSessionQueryCache();
        resetBreweryTheme();
        ensureAppShellBranding();
        setUsuario(null);
        setCervejaria(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, senha: string) => {
    const data = await api.post<AuthResponse>('/api/auth/login', { email, senha });
    applyAuth(data);
    flushPendingAuditAfterAuth();
    return data;
  };

  return (
    <AuthContext.Provider
      value={{
        usuario,
        cervejaria,
        isAuthenticated: !!usuario,
        isLoading,
        login,
        logout,
        updateCervejaria,
        isDono: usuario?.papel === 'DONO',
        isAdmin: usuario?.papel === 'ADMIN',
        podeDarDescontoOperacao:
          usuario?.papel === 'DONO' ||
          (Array.isArray(usuario?.permissoesOperacao)
            ? usuario.permissoesOperacao.includes('discount.apply')
            : usuario?.papel === 'ADMIN' || Boolean(usuario?.podeDarDescontoOperacao)),
        hasPermission: (permission: string) => usuario?.papel === 'DONO'
          || usuario?.permissoesOperacao?.includes(permission) === true,
        canPermission: (permission: string) => usuario?.papel === 'DONO'
          || (Array.isArray(usuario?.permissoesOperacao)
            ? usuario.permissoesOperacao.includes(permission)
            : true),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
