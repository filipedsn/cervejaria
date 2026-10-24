import { createCorrelationId } from './correlation-id';

export const INTERACTION_ID_HEADER = 'X-Interaction-Id';
let current: string | undefined;

/** Include microtasks (React Query mutations), then expire at the next task. */
export function beginInteraction(): string {
  const id = createCorrelationId();
  current = id;
  setTimeout(() => { if (current === id) current = undefined; }, 0);
  return id;
}

export function currentInteractionId(): string | undefined { return current; }
