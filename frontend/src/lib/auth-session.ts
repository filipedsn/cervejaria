type UnauthorizedHandler = () => void | Promise<void>;

let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

export async function notifyUnauthorized(): Promise<void> {
  if (onUnauthorized) await onUnauthorized();
}
