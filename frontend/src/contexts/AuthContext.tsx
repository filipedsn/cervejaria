import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Usuario, Cervejaria, AuthResponse } from '../types';
import { api } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { resetBreweryTheme, syncBreweryTheme } from '../lib/theme';
import { ensureAppShellBranding } from '../lib/app-branding';

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
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cervejaria, setCervejaria] = useState<Cervejaria | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyAuth = useCallback((data: AuthResponse) => {
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
    api
      .get<{ usuario: Usuario; cervejaria: Cervejaria | null }>('/api/auth/me')
      .then((data) => {
        resetBreweryTheme();
        setUsuario(data.usuario);
        setCervejaria(data.cervejaria);
        syncBreweryTheme(data.usuario, data.cervejaria);
        ensureAppShellBranding();
        if (data.cervejaria) {
          connectSocket(data.cervejaria.id);
        }
      })
      .catch(() => {
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
