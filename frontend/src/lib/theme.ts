import type { Cervejaria, BrandTheme } from '../types';
import { applyAppTheme, getAppTheme } from './app-theme';

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

/**
 * Remove quaisquer overrides de cor por cervejaria e volta à paleta Quiver Cloud.
 * A identidade visual da plataforma é fixa; a logo
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
  applyAppTheme(getAppTheme());
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
