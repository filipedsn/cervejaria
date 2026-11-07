type UnauthorizedHandler = () => void | Promise<void>;

let onUnauthorized: UnauthorizedHandler | null = null;

const publicAuthPaths = new Set(['/login', '/forgot-password', '/reset-password']);

/** Returned by the API when the user's company was deactivated by the platform admin. */
export const TENANT_INACTIVE_CODE = 'TENANT_INACTIVE';

const LOGIN_NOTICE_KEY = 'authLoginNotice';

/** Routes that deliberately work without an employee session. */
export function isPublicPath(pathname: string): boolean {
  return publicAuthPaths.has(pathname) || pathname.startsWith('/c/') || pathname.startsWith('/ranking/tv') || pathname === '/operacao/cozinha/tv' || pathname === '/operacao/bar/tv';
}

/** Public auth pages must remain reachable when the session bootstrap returns 401. */
export function isPublicAuthPath(pathname: string): boolean {
  return isPublicPath(pathname);
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

export async function notifyUnauthorized(): Promise<void> {
  if (onUnauthorized) await onUnauthorized();
}

/** The forced logout reloads the page, so the reason survives in sessionStorage until the login screen reads it. */
export function saveLoginNotice(message: string): void {
  try {
    sessionStorage.setItem(LOGIN_NOTICE_KEY, message);
  } catch {
    /* storage unavailable: the login screen simply shows no notice */
  }
}

export function readLoginNotice(): string {
  try {
    return sessionStorage.getItem(LOGIN_NOTICE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function clearLoginNotice(): void {
  try {
    sessionStorage.removeItem(LOGIN_NOTICE_KEY);
  } catch {
    /* storage unavailable */
  }
}
