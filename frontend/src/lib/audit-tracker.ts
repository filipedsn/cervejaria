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
  type: UiEventType;
  page: string;
  element?: string;
  label?: string;
  timestamp?: string;
  meta?: Record<string, unknown>;
  http?: HttpRequestTelemetry;
};

const queue: UiEvent[] = [];
const pendingPreAuth: UiEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

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
  const batch = queue.splice(0, 50);
  try {
    const res = await fetch(`${API_BASE}/api/audit/events`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', [CORRELATION_ID_HEADER]: createCorrelationId() },
      body: JSON.stringify({ events: batch }),
    });
    if (res.status === 401) {
      pendingPreAuth.push(...batch);
      return;
    }
    if (!res.ok) {
      queue.unshift(...batch);
    }
  } catch {
    queue.unshift(...batch);
  }
}

/** Drena eventos enfileirados antes do login (ex.: page_view em /login). */
export function flushPendingAuditAfterAuth(): void {
  if (pendingPreAuth.length === 0) return;
  queue.push(...pendingPreAuth.splice(0, pendingPreAuth.length));
  void flushAuditEvents();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAuditEvents();
  }, 5000);
}

function enqueue(event: UiEvent): void {
  queue.push({
    ...event,
    meta: { frontendReleaseSha, ...event.meta },
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
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
    const body = JSON.stringify({ events: queue.splice(0, 50) });
    navigator.sendBeacon(`${API_BASE}/api/audit/events`, new Blob([body], { type: 'application/json' }));
  });
}
