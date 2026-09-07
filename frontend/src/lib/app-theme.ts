export type AppTheme = 'light' | 'dark';

const STORAGE_KEY = 'quiver:theme';

export const THEME_COLORS: Record<AppTheme, string> = {
  light: '#f6f9fc',
  dark: '#040a12',
};

export function getAppTheme(): AppTheme {
  if (typeof localStorage === 'undefined') return 'light';
  return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
}

export function setAppTheme(theme: AppTheme): void {
  if (typeof localStorage === 'undefined') return;
  if (theme === 'dark') {
    localStorage.setItem(STORAGE_KEY, 'dark');
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function setMetaThemeColor(color: string): void {
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

export function applyAppTheme(theme: AppTheme): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.dataset.theme = 'dark';
    root.style.colorScheme = 'dark';
  } else {
    delete root.dataset.theme;
    root.style.colorScheme = 'light';
  }
  setMetaThemeColor(THEME_COLORS[theme]);
}

export function initAppTheme(): AppTheme {
  const theme = getAppTheme();
  applyAppTheme(theme);
  return theme;
}
