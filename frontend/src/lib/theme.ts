import type { Cervejaria, BrandTheme } from '../types';

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

/** Status bar / PWA theme-color no tema claro Quiver Tap. */
const DEFAULT_THEME_COLOR = '#f7f8fa';

function setMetaThemeColor(color: string) {
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

/**
 * Remove quaisquer overrides de cor por cervejaria e volta à paleta Quiver.
 * A identidade visual passou a ser fixa (teal Quiver via `.qt-light`); a logo
 * da cervejaria continua sendo exibida no header, mas as cores são padronizadas.
 */
export function resetBreweryTheme(): void {
  const root = document.documentElement;
  for (const shade of SHADES) {
    root.style.removeProperty(`--color-brand-${shade}`);
  }
  root.style.removeProperty('--color-surface');
  root.style.removeProperty('--color-surface-light');
  root.style.removeProperty('--color-surface-lighter');
  setMetaThemeColor(DEFAULT_THEME_COLOR);
}

/** Mantido por compatibilidade — a paleta é fixa, então apenas normaliza. */
export function applyBrandTheme(_theme: BrandTheme | null): void {
  resetBreweryTheme();
}

/** Mantido por compatibilidade — cor por cervejaria foi descontinuada. */
export function applyBreweryTheme(_cervejaria: Cervejaria | null): void {
  resetBreweryTheme();
}

/** Mantido por compatibilidade — cor por cervejaria foi descontinuada. */
export function syncBreweryTheme(
  _usuario: { papel: string } | null,
  _cervejaria: Cervejaria | null,
): void {
  resetBreweryTheme();
}
