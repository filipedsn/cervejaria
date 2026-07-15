import { api } from './api';

function normalizeOrigin(value: string) {
  return value.replace(/\/$/, '');
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Origem pública para links/QR (celular na mesma rede). */
export function getConfiguredPublicAppOrigin(): string | null {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  return configured ? normalizeOrigin(configured) : null;
}

export function getBrowserAppOrigin(): string {
  return normalizeOrigin(window.location.origin);
}

export function isQrUsingLocalhost(origin: string) {
  try {
    return isLocalHostname(new URL(origin).hostname);
  } catch {
    return true;
  }
}

let cachedLanOrigin: string | null | undefined;

/** Resolve origem acessível no celular (LAN IP em dev). */
export async function resolvePublicAppOrigin(): Promise<string> {
  const configured = getConfiguredPublicAppOrigin();
  if (configured) return configured;

  const browserOrigin = getBrowserAppOrigin();
  if (!isQrUsingLocalhost(browserOrigin)) return browserOrigin;

  if (cachedLanOrigin !== undefined) {
    return cachedLanOrigin ?? browserOrigin;
  }

  try {
    const hint = await api.get<{ origin: string | null }>('/api/public/dev/app-origin');
    cachedLanOrigin = hint.origin ? normalizeOrigin(hint.origin) : null;
  } catch {
    cachedLanOrigin = null;
  }

  return cachedLanOrigin ?? browserOrigin;
}

export function buildPublicAppUrl(path: string, origin: string) {
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}
