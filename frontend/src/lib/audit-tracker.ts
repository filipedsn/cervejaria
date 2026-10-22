import { CORRELATION_ID_HEADER, createCorrelationId } from './correlation-id';
import { frontendReleaseSha } from './release-context';

const API_BASE = import.meta.env?.VITE_API_URL ?? '';

type UiEventType = 'click' | 'page_view' | 'submit' | 'error' | 'http_request';

export type HttpRequestOutcome = 'success' | 'client_error' | 'server_error' | 'network_error' | 'aborted' | 'timeout';

export type HttpRequestTelemetry = {
  method: string;
  route: string;
  statusCode?: number;
  durationMs: number;
  outcome: HttpRequestOutcome;
  correlationId: string;
  requestId?: string;
};

type UiEvent = {
  id?: string;
  type: UiEventType;
  page: string;
  element?: string;
  label?: string;
  timestamp?: string;
  meta?: Record<string, unknown>;
  http?: HttpRequestTelemetry;
  session?: { actorId: string; cervejariaId: string | null };
  portalSession?: { comandaId: string; slug: string };
  attempts?: number;
};

const queue: UiEvent[] = [];
const pendingPreAuth: UiEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let identity: UiEvent['session'];
let portalIdentity: UiEvent['portalSession'];
let generation = 0;
let inFlight = false;
let activeRequest: AbortController | undefined;
let dropped = 0;
const MAX_QUEUE = 200;
const MAX_AGE_MS = 15 * 60_000;

export function getAuditQueueStats() { return { queued: queue.length + pendingPreAuth.length, dropped }; }

/** Bind memory to the authenticated origin; never persist UI/identity to disk. */
export function setAuditIdentity(actorId: string | null, cervejariaId: string | null): void {
  const next = actorId ? { actorId, cervejariaId } : undefined;
  if (JSON.stringify(next) === JSON.stringify(identity) && actorId && !portalIdentity) return;
  generation++;
  activeRequest?.abort();
  const preLogin = actorId ? [...queue, ...pendingPreAuth].filter(e => !e.session && e.page === '/login' && e.type === 'page_view') : [];
  dropped += queue.length + pendingPreAuth.length - preLogin.length;
  queue.length = pendingPreAuth.length = 0;
  queue.push(...preLogin);
  identity = next;
  portalIdentity = undefined;
  errorDedup.clear(); errorCountSession = 0;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

export function setAuditPortalSession(comandaId: string | null, slug: string | null): void {
  if (comandaId && portalIdentity?.comandaId === comandaId && portalIdentity.slug === slug) return;
  setAuditIdentity(null, null);
  if (comandaId && slug) {
    portalIdentity = { comandaId, slug };
    trackPageView();
  }
}

function trimQueue(): void {
  for (const buffer of [queue, pendingPreAuth]) {
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (Date.now() - Date.parse(buffer[i].timestamp ?? '') > MAX_AGE_MS || (buffer[i].attempts ?? 0) >= 5) { buffer.splice(i, 1); dropped++; }
    }
  }
  while (queue.length + pendingPreAuth.length > MAX_QUEUE) {
    (pendingPreAuth.length ? pendingPreAuth : queue).shift(); dropped++;
  }
}

/** Dedup de ui.error — evita laço em render quebrado. */
const errorDedup = new Map<string, number>();
const ERROR_DEDUP_MS = 60_000;
const ERROR_MAX_PER_SESSION = 20;
let errorCountSession = 0;

function currentPage(): string {
  return window.location.pathname;
}

function safePagePath(page: string): string {
  try {
    return new URL(page, 'http://frontend.local').pathname;
  } catch {
    return page.split(/[?#]/, 1)[0] || '/';
  }
}

function resolveSemanticAction(el: HTMLElement): string | null {
  // Audit only an explicit, developer-defined action. Reading arbitrary DOM
  // text here turns telemetry into an accidental PII collector and makes a
  // "click" impossible to interpret operationally.
  return el.getAttribute('data-audit');
}

function errorFingerprint(message: string, stack?: string): string {
  const base = `${message}|${(stack ?? '').slice(0, 200)}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) | 0;
  return String(h);
}

function shouldEmitError(message: string, stack?: string): boolean {
  if (errorCountSession >= ERROR_MAX_PER_SESSION) return false;
  const fp = errorFingerprint(message, stack);
  const now = Date.now();
  const last = errorDedup.get(fp);
  if (last != null && now - last < ERROR_DEDUP_MS) return false;
  errorDedup.set(fp, now);
  errorCountSession += 1;
  return true;
}

export async function flushAuditEvents(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  trimQueue();
  if (inFlight || queue.length === 0) return;
  inFlight = true;
  const originGeneration = generation;
  const controller = new AbortController(); activeRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const batch = queue.splice(0, 50);
  for (const event of batch) event.attempts = (event.attempts ?? 0) + 1;
  try {
    const res = await fetch(`${API_BASE}/api/audit/events`, {
      method: 'POST',
      signal: controller.signal,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', [CORRELATION_ID_HEADER]: createCorrelationId() },
      body: JSON.stringify({ events: batch }),
    });
    if (res.status === 401) {
      if (originGeneration === generation) {
        const anonymous = batch.filter(e => !e.session && e.page === '/login' && e.type === 'page_view');
        pendingPreAuth.push(...anonymous); dropped += batch.length - anonymous.length;
      }
      return;
    }
    if (res.status === 409) { dropped += batch.length; return; }
    if (!res.ok && originGeneration === generation) {
      queue.unshift(...batch);
    }
  } catch {
    if (originGeneration === generation) queue.unshift(...batch);
  } finally {
    clearTimeout(timeout);
    inFlight = false;
    if (activeRequest === controller) activeRequest = undefined;
    trimQueue();
    if (queue.length) scheduleFlush();
  }
}

/** Drena eventos enfileirados antes do login (ex.: page_view em /login). */
export function flushPendingAuditAfterAuth(): void {
  queue.push(...pendingPreAuth.splice(0, pendingPreAuth.length));
  trimQueue();
  void flushAuditEvents();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAuditEvents();
  }, Math.min(30_000, 1000 * 2 ** Math.min(5, queue[0]?.attempts ?? 2)));
}

function enqueue(event: UiEvent): void {
  queue.push({
    ...event,
    id: createCorrelationId(),
    session: identity,
    portalSession: portalIdentity,
    meta: { frontendReleaseSha, ...event.meta },
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
  trimQueue();
  if (queue.length >= 20) {
    void flushAuditEvents();
    return;
  }
  scheduleFlush();
}

export function trackPageView(page: string = currentPage()): void {
  enqueue({ type: 'page_view', page: safePagePath(page) });
}

export function trackClick(label: string, meta?: Record<string, unknown>, element?: string): void {
  enqueue({
    type: 'click',
    page: currentPage(),
    label,
    element,
    meta,
  });
}

export function trackSubmit(label: string, meta?: Record<string, unknown>): void {
  enqueue({
    type: 'submit',
    page: currentPage(),
    label,
    meta,
  });
}

/** One terminal record per API request. The transport bypasses api.ts, preventing recursion. */
export function trackHttpRequest(http: HttpRequestTelemetry): void {
  enqueue({ type: 'http_request', page: http.route, http });
}

export function trackUiError(message: string, stack?: string, meta?: Record<string, unknown>): void {
  if (!shouldEmitError(message, stack)) return;
  enqueue({
    type: 'error',
    page: currentPage(),
    // Browser and API errors can echo user input. Keep the fingerprint local
    // for deduplication and send only the semantic failure category.
    label: 'frontend_error',
    meta: {
      ...meta,
    },
  });
}

export function initAuditTracker(): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  document.addEventListener(
    'click',
    (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest('[data-audit]') as HTMLElement | null;
      if (!el) return;
      const action = resolveSemanticAction(el);
      if (!action) return;
      trackClick(action, { tag: el.tagName.toLowerCase() }, action);
    },
    { capture: true },
  );

  document.addEventListener('submit', (ev) => {
    const form = ev.target as HTMLFormElement | null;
    const action = form?.getAttribute('data-audit');
    if (action) trackSubmit(action);
  });

  window.addEventListener('error', (ev) => {
    const msg = ev.message || 'Erro JavaScript';
    const stack = ev.error instanceof Error ? ev.error.stack : undefined;
    trackUiError(msg, stack, { source: ev.filename, line: ev.lineno });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    trackUiError(msg, stack, { kind: 'unhandledrejection' });
  });

  window.addEventListener('beforeunload', () => {
    if (queue.length === 0) return;
    trimQueue();
    const batch = queue.slice(0, 50);
    const body = JSON.stringify({ events: batch });
    if (navigator.sendBeacon(`${API_BASE}/api/audit/events`, new Blob([body], { type: 'application/json' }))) queue.splice(0, batch.length);
  });
}
