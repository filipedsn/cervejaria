type UnauthorizedHandler = () => void | Promise<void>;

let onUnauthorized: UnauthorizedHandler | null = null;

const publicAuthPaths = new Set(['/login', '/forgot-password', '/reset-password']);

/** Routes that deliberately work without an employee session. */
export function isPublicPath(pathname: string): boolean {
  return publicAuthPaths.has(pathname) || pathname.startsWith('/c/') || pathname.startsWith('/ranking/tv');
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
