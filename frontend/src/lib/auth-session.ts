type UnauthorizedHandler = () => void | Promise<void>;

let onUnauthorized: UnauthorizedHandler | null = null;

const publicAuthPaths = new Set(['/login', '/forgot-password', '/reset-password']);

/** Public auth pages must remain reachable when the session bootstrap returns 401. */
export function isPublicAuthPath(pathname: string): boolean {
  return publicAuthPaths.has(pathname);
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

export async function notifyUnauthorized(): Promise<void> {
  if (onUnauthorized) await onUnauthorized();
}
