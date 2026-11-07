import { CORRELATION_ID_HEADER, createCorrelationId } from './correlation-id';
import { frontendReleaseSha } from './release-context';
import { beginInteraction, currentInteractionId } from './interaction-context';
import { compactIntent, currentAuditContext, type AuditIntent, type AuditPrimitive } from './audit-context';
import {
  CLICK_TARGET_SELECTOR,
  accessibleName,
  collapseText,
  createAuditSessionId,
  elementRole,
  isSearchField,
  roundVital,
  routeTemplate,
  vitalRating,
  type WebVitalName,
  type WebVitalRating,
} from './audit-journey';

const API_BASE = import.meta.env?.VITE_API_URL ?? '';

type UiEventType = 'click' | 'page_view' | 'submit' | 'error' | 'http_request' | 'search' | 'web_vital' | 'navigation';

export type HttpRequestOutcome = 'success' | 'client_error' | 'server_error' | 'network_error' | 'aborted' | 'timeout' | 'invalid_response';

export type HttpRequestTelemetry = {
  method: string;
  route: string;
  statusCode?: number;
  durationMs: number;
  outcome: HttpRequestOutcome;
  correlationId: string;
  requestId?: string;
  interactionId?: string;
};

type UiEvent = {
  type: UiEventType;
  page: string;
  route?: string;
  sessionId?: string;
  element?: string;
  label?: string;
  search?: string;
  vitals?: { name: WebVitalName; value: number; rating: WebVitalRating };
  error?: { message: string; stack?: string; name?: string };
  viewport?: { w: number; h: number };
  timestamp?: string;
  interactionId?: string;
  meta?: Record<string, unknown>;
  http?: HttpRequestTelemetry;
  context?: Record<string, AuditPrimitive>;
  intent?: AuditIntent;
};

export type AuditFunctionalExtras = {
  /** Snapshot taken when the action started; defaults to the live screen context. */
  context?: Record<string, AuditPrimitive>;
  intent?: AuditIntent;
};

const queue: UiEvent[] = [];
const MAX_QUEUE = 500;
let flushing = false;
let sessionEpoch = 0;
let lastPageView: string | undefined;
let lastPageViewAt: number | undefined;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

const SESSION_STORAGE_KEY = 'tap.audit.session';
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
let auditSession: string | undefined;

/** Dedup de ui.error — evita laço em render quebrado. */
const errorDedup = new Map<string, number>();
const ERROR_DEDUP_MS = 60_000;
const ERROR_MAX_PER_SESSION = 20;
let errorCountSession = 0;

const SEARCH_DEBOUNCE_MS = 800;
const searchTimers = new WeakMap<HTMLInputElement, ReturnType<typeof setTimeout>>();
const lastSearchTerm = new WeakMap<HTMLInputElement, string>();

const pendingVitals = new Map<WebVitalName, number>();
let cumulativeLayoutShift = 0;
let slowestInteraction = 0;

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

function readStoredSession(): string | undefined {
  try {
    const stored = globalThis.sessionStorage?.getItem(SESSION_STORAGE_KEY);
    return stored && SESSION_ID_PATTERN.test(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function storeSession(id: string): void {
  try {
    globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // Private mode or storage disabled: the in-memory session still groups this tab.
  }
}

function auditSessionId(): string {
  if (!auditSession) {
    auditSession = readStoredSession() ?? createAuditSessionId();
    storeSession(auditSession);
  }
  return auditSession;
}

function currentViewport(): { w: number; h: number } | undefined {
  if (typeof window === 'undefined') return undefined;
  return { w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) };
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
  if (flushing) return;
  flushing = true;
  const batchEpoch = sessionEpoch;
  const batch = queue.splice(0, 50);
  try {
    const res = await fetch(`${API_BASE}/api/audit/events`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', [CORRELATION_ID_HEADER]: createCorrelationId() },
      body: JSON.stringify({ events: batch }),
    });
    if (res.status === 401) {
      // Never replay anonymous/previous-operator actions as the next operator.
      if (batchEpoch === sessionEpoch) queue.length = 0;
      return;
    }
    if (!res.ok) {
      if (batchEpoch === sessionEpoch) queue.unshift(...batch);
    }
  } catch {
    if (batchEpoch === sessionEpoch) queue.unshift(...batch);
  } finally {
    flushing = false;
    if (queue.length > MAX_QUEUE) queue.splice(MAX_QUEUE);
    if (queue.length > 0) scheduleFlush();
  }
}

/** Starts a fresh audit session without reattributing records to another actor. */
export function flushPendingAuditAfterAuth(): void {
  // Old pre-auth events are intentionally not assigned to a newly authenticated actor.
  queue.length = 0;
  sessionEpoch += 1;
  lastPageView = undefined;
  lastPageViewAt = undefined;
  pendingVitals.clear();
  // A new operator on the same tab must not share the previous browsing session.
  auditSession = createAuditSessionId();
  storeSession(auditSession);
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAuditEvents();
  }, 5000);
}

function enqueue(event: UiEvent): void {
  if (queue.length >= MAX_QUEUE) queue.shift();
  const { context: explicitContext, intent: rawIntent, ...rest } = event;
  const context = explicitContext ?? currentAuditContext();
  const intent = compactIntent(rawIntent);
  queue.push({
    ...rest,
    route: event.route ?? routeTemplate(event.page),
    sessionId: auditSessionId(),
    meta: { frontendReleaseSha, ...event.meta },
    ...(context ? { context } : {}),
    ...(intent ? { intent } : {}),
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
  if (queue.length >= 20) {
    void flushAuditEvents();
    return;
  }
  scheduleFlush();
}

function flushWebVitals(): void {
  const page = lastPageView;
  if (page && pendingVitals.size > 0) {
    for (const [name, value] of pendingVitals) {
      enqueue({ type: 'web_vital', page, vitals: { name, value: roundVital(name, value), rating: vitalRating(name, value) } });
    }
  }
  pendingVitals.clear();
  cumulativeLayoutShift = 0;
  slowestInteraction = 0;
}

export function trackPageView(page: string = currentPage()): void {
  const safe = safePagePath(page);
  if (lastPageView === safe) return;
  flushWebVitals();
  const now = Date.now();
  const sinceLastMs = lastPageViewAt === undefined ? undefined : Math.min(Math.max(now - lastPageViewAt, 0), 86_400_000);
  lastPageView = safe;
  lastPageViewAt = now;
  const viewport = currentViewport();
  enqueue({
    type: 'page_view',
    page: safe,
    ...(viewport ? { viewport } : {}),
    ...(sinceLastMs !== undefined ? { meta: { sinceLastMs } } : {}),
  });
}

export function trackClick(label: string, meta?: Record<string, unknown>, element?: string): void {
  enqueue({
    interactionId: beginInteraction(),
    type: 'click',
    page: currentPage(),
    label,
    element,
    meta,
  });
}

export function trackSubmit(label: string, meta?: Record<string, unknown>): void {
  enqueue({
    interactionId: currentInteractionId() ?? beginInteraction(),
    type: 'submit',
    page: currentPage(),
    label,
    meta,
  });
}

export function trackSearch(term: string, label?: string): void {
  const search = collapseText(term, 200);
  if (!search) return;
  enqueue({
    interactionId: currentInteractionId() ?? beginInteraction(),
    type: 'search',
    page: currentPage(),
    element: 'searchbox',
    label,
    search,
  });
}

/** One terminal record per API request. The transport bypasses api.ts, preventing recursion. */
export function trackHttpRequest(http: HttpRequestTelemetry): void {
  enqueue({ type: 'http_request', page: http.route, http });
}

export function trackUiError(
  message: string,
  stack?: string,
  meta?: Record<string, unknown>,
  errorName?: string,
  label = 'frontend_error',
  extras: AuditFunctionalExtras = {},
): void {
  if (!shouldEmitError(message, stack)) return;
  enqueue({
    type: 'error',
    page: currentPage(),
    label: collapseText(label, 300) || 'frontend_error',
    error: {
      message: message.slice(0, 500),
      ...(stack ? { stack: stack.slice(0, 4000) } : {}),
      ...(errorName ? { name: errorName.slice(0, 100) } : {}),
    },
    meta: {
      ...meta,
    },
    context: extras.context,
    intent: extras.intent,
  });
}

/** Terminal record of a business action (success or failure) with what the operator intended. */
export function trackAction(input: {
  operation: string;
  feature?: string;
  outcome: 'success' | 'failure';
  entityType?: string;
  entityId?: string;
  durationMs?: number;
} & AuditFunctionalExtras): void {
  enqueue({
    interactionId: currentInteractionId(),
    type: 'submit',
    page: currentPage(),
    label: collapseText(input.operation, 300) || 'action',
    meta: {
      operation: input.operation,
      ...(input.feature ? { feature: input.feature } : {}),
      actionOutcome: input.outcome,
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(input.durationMs !== undefined ? { durationMs: Math.round(input.durationMs) } : {}),
    },
    context: input.context,
    intent: input.intent,
  });
}

function numberProperty(entry: PerformanceEntry, key: string): number | undefined {
  const value: unknown = Reflect.get(entry, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function observePerformance(type: string, onEntries: (entries: PerformanceEntryList) => void, durationThreshold?: number): void {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) return;
  try {
    const init: PerformanceObserverInit & { durationThreshold?: number } = {
      type,
      buffered: true,
      ...(durationThreshold !== undefined ? { durationThreshold } : {}),
    };
    new PerformanceObserver((list) => onEntries(list.getEntries())).observe(init);
  } catch {
    // Unsupported observer options must never break the app.
  }
}

function initWebVitals(): void {
  observePerformance('largest-contentful-paint', (entries) => {
    const last = entries.at(-1);
    if (last) pendingVitals.set('LCP', last.startTime);
  });
  observePerformance('layout-shift', (entries) => {
    for (const entry of entries) {
      if (Reflect.get(entry, 'hadRecentInput') === true) continue;
      cumulativeLayoutShift += numberProperty(entry, 'value') ?? 0;
    }
    pendingVitals.set('CLS', cumulativeLayoutShift);
  });
  observePerformance('event', (entries) => {
    for (const entry of entries) {
      if (!numberProperty(entry, 'interactionId')) continue;
      slowestInteraction = Math.max(slowestInteraction, entry.duration);
    }
    if (slowestInteraction > 0) pendingVitals.set('INP', slowestInteraction);
  }, 40);
  observePerformance('paint', (entries) => {
    const fcp = entries.find((entry) => entry.name === 'first-contentful-paint');
    if (fcp) pendingVitals.set('FCP', fcp.startTime);
  });
  observePerformance('navigation', (entries) => {
    const responseStart = entries[0] ? numberProperty(entries[0], 'responseStart') : undefined;
    if (responseStart !== undefined && responseStart > 0) pendingVitals.set('TTFB', responseStart);
  });
}

function sendPendingWithBeacon(): void {
  if (queue.length === 0) return;
  const body = JSON.stringify({ events: queue.splice(0, 50) });
  navigator.sendBeacon(`${API_BASE}/api/audit/events`, new Blob([body], { type: 'application/json' }));
}

function isIgnored(el: Element): boolean {
  return el.closest('[data-audit-ignore]') !== null;
}

function scheduleSearch(input: HTMLInputElement, immediate: boolean): void {
  const pending = searchTimers.get(input);
  if (pending) clearTimeout(pending);
  const emit = () => {
    searchTimers.delete(input);
    const term = collapseText(input.value, 200);
    if (!term || lastSearchTerm.get(input) === term) return;
    lastSearchTerm.set(input, term);
    trackSearch(term, accessibleName(input));
  };
  if (immediate) emit();
  else searchTimers.set(input, setTimeout(emit, SEARCH_DEBOUNCE_MS));
}

export function initAuditTracker(): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  document.addEventListener(
    'click',
    (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const el = target.closest(CLICK_TARGET_SELECTOR);
      if (!(el instanceof HTMLElement) || isIgnored(el)) return;
      const action = el.getAttribute('data-audit') || accessibleName(el);
      trackClick(action, { tag: el.tagName.toLowerCase() }, elementRole(el));
    },
    { capture: true },
  );

  document.addEventListener(
    'change',
    (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLSelectElement) || isIgnored(target)) return;
      const option = collapseText(target.selectedOptions[0]?.text, 80);
      trackClick(`select:${accessibleName(target)}`, { tag: 'select', ...(option ? { option } : {}) }, 'select');
    },
    { capture: true },
  );

  document.addEventListener(
    'input',
    (ev) => {
      const target = ev.target;
      if (target instanceof HTMLInputElement && isSearchField(target) && !isIgnored(target)) scheduleSearch(target, false);
    },
    { capture: true },
  );

  document.addEventListener(
    'keydown',
    (ev) => {
      const target = ev.target;
      if (ev.key === 'Enter' && target instanceof HTMLInputElement && isSearchField(target) && !isIgnored(target)) {
        scheduleSearch(target, true);
      }
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
    const error = ev.error instanceof Error ? ev.error : undefined;
    trackUiError(
      msg,
      error?.stack,
      {
        handled: false,
        kind: 'ui_bug',
        scenario: 'window_error',
        source: ev.filename,
        line: ev.lineno,
      },
      error?.name,
      'window.error',
    );
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    const error = reason instanceof Error ? reason : undefined;
    trackUiError(
      msg,
      error?.stack,
      {
        handled: false,
        kind: error?.name === 'TypeError' || error?.name === 'ReferenceError' ? 'ui_bug' : 'unknown',
        scenario: 'unhandledrejection',
      },
      error?.name,
      'unhandledrejection',
    );
  });

  initWebVitals();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    flushWebVitals();
    sendPendingWithBeacon();
  });

  window.addEventListener('beforeunload', () => {
    flushWebVitals();
    sendPendingWithBeacon();
  });
}
