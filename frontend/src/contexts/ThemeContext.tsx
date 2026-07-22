import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  applyAppTheme,
  getAppTheme,
  initAppTheme,
  setAppTheme,
  type AppTheme,
} from '../lib/app-theme';

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => initAppTheme());

  const setTheme = useCallback((next: AppTheme) => {
    setAppTheme(next);
    applyAppTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setTheme, theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

/** Restaura tema salvo após telas que alteram theme-color (ex.: login). */
export function restoreAppThemeFromStorage(): void {
  applyAppTheme(getAppTheme());
}
