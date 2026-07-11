import { APP_NAME } from './brand';

export { APP_NAME };

/** Ícone quadrado para PWA / atalho na tela inicial */
export const APP_ICON_192 = '/icons/pwa-192.png';
export const APP_ICON_512 = '/icons/pwa-512.png';
/** Logo completa (login, admin) */
export const APP_LOGO = '/logo.png';
export const APP_THEME_COLOR = '#f7f8fa';

function upsertLink(rel: string, href: string, sizes?: string) {
  const selector = sizes
    ? `link[rel="${rel}"][sizes="${sizes}"]`
    : `link[rel="${rel}"]:not([sizes])`;
  let link = document.querySelector(selector) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    if (sizes) link.sizes = sizes;
    document.head.appendChild(link);
  }
  link.href = href;
  link.type = 'image/png';
}

/** Mantém favicon e ícone do atalho sempre com a marca Quiver Tap (nunca logo da cervejaria). */
export function ensureAppShellBranding(): void {
  document.title = APP_NAME;

  upsertLink('icon', APP_ICON_192);
  upsertLink('icon', APP_ICON_512, '512x512');
  upsertLink('apple-touch-icon', APP_ICON_192, '180x180');

  document.querySelectorAll('link[rel*="icon"]').forEach((node) => {
    const href = node.getAttribute('href') ?? '';
    if (href.includes('/uploads/')) node.remove();
  });
}
