const API_BASE = import.meta.env.VITE_API_URL ?? '';

type UiEventType = 'click' | 'page_view' | 'submit';

type UiEvent = {
  type: UiEventType;
  page: string;
  element?: string;
  label?: string;
  timestamp?: string;
  meta?: Record<string, unknown>;
};

const queue: UiEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function currentPage(): string {
  return `${window.location.pathname}${window.location.search}`;
}

async function flushEvents(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, 50);
  try {
    await fetch(`${API_BASE}/api/audit/events`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    queue.unshift(...batch);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushEvents();
  }, 5000);
}

function enqueue(event: UiEvent): void {
  queue.push({
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
  if (queue.length >= 20) {
    void flushEvents();
    return;
  }
  scheduleFlush();
}

export function trackPageView(page: string = currentPage()): void {
  enqueue({ type: 'page_view', page });
}

export function trackClick(label: string, meta?: Record<string, unknown>): void {
  enqueue({
    type: 'click',
    page: currentPage(),
    label,
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

export function initAuditTracker(): void {
  if (typeof window === 'undefined') return;

  document.addEventListener(
    'click',
    (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest('button, a, [data-audit]') as HTMLElement | null;
      if (!el) return;
      const label =
        el.getAttribute('data-audit') ??
        el.getAttribute('aria-label') ??
        el.textContent?.trim().slice(0, 120) ??
        el.tagName.toLowerCase();
      trackClick(label, { tag: el.tagName.toLowerCase() });
    },
    { capture: true },
  );

  document.addEventListener('submit', (ev) => {
    const form = ev.target as HTMLFormElement | null;
    const label = form?.getAttribute('data-audit') ?? form?.getAttribute('name') ?? 'form';
    trackSubmit(label);
  });

  window.addEventListener('beforeunload', () => {
    if (queue.length === 0) return;
    const body = JSON.stringify({ events: queue.splice(0, 50) });
    navigator.sendBeacon(`${API_BASE}/api/audit/events`, new Blob([body], { type: 'application/json' }));
  });
}
