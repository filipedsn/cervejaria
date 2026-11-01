import { createCorrelationId } from './correlation-id';

export type WebVitalName = 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP';
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

export const CLICK_TARGET_SELECTOR = [
  'button', 'a[href]', '[role=button]', '[role=menuitem]', '[role=tab]', '[role=link]',
  'input[type=checkbox]', 'input[type=radio]', 'input[type=submit]', 'summary', '[data-audit]',
].join(', ');

/** Minimal DOM surface so naming rules stay testable outside the browser. */
export type AuditElementLike = {
  tagName: string;
  getAttribute(name: string): string | null;
  innerText?: string;
  textContent?: string | null;
  labels?: ArrayLike<{ innerText?: string; textContent: string | null }> | null;
};

export function collapseText(value: string | null | undefined, maxLength: number): string | undefined {
  const collapsed = (value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return collapsed ? collapsed.slice(0, maxLength) : undefined;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUID_SEGMENT = /^c[a-z0-9]{20,}$/;
const HEX_SEGMENT = /^[0-9a-f]{16,}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const LONG_DIGITS = /\d{5,}/;

/** Route model for grouping screens: entity identifiers become `:id`. */
export function routeTemplate(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] || '/';
  return pathname
    .split('/')
    .map((segment) => (
      segment && (
        UUID_SEGMENT.test(segment) || CUID_SEGMENT.test(segment) || HEX_SEGMENT.test(segment)
        || NUMERIC_SEGMENT.test(segment) || LONG_DIGITS.test(segment)
      ) ? ':id' : segment
    ))
    .join('/');
}

function isFormField(tag: string): boolean {
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function labelText(el: AuditElementLike): string | undefined {
  const label = el.labels?.[0];
  return label ? collapseText(label.innerText ?? label.textContent, 80) : undefined;
}

/** Accessible name without ever reading the value typed into a field. */
export function accessibleName(el: AuditElementLike): string {
  const tag = el.tagName.toLowerCase();
  const fromAttributes = collapseText(el.getAttribute('aria-label'), 80) ?? collapseText(el.getAttribute('title'), 80);
  if (fromAttributes) return fromAttributes;
  const visible = isFormField(tag)
    ? labelText(el) ?? collapseText(el.getAttribute('placeholder'), 80)
    : collapseText(el.innerText ?? el.textContent, 80);
  return visible ?? collapseText(el.getAttribute('name'), 80) ?? tag;
}

export function elementRole(el: AuditElementLike): string {
  const role = collapseText(el.getAttribute('role'), 40);
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'summary') return 'button';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'button') return 'button';
    return type;
  }
  return tag;
}

const SEARCH_PLACEHOLDER = /buscar|pesquisar|procurar/i;
const NON_SEARCH_INPUT_TYPES = new Set(['password', 'hidden', 'email', 'tel', 'number', 'checkbox', 'radio', 'file']);

export function isSearchField(el: AuditElementLike): boolean {
  if (el.tagName.toLowerCase() !== 'input') return false;
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  if (NON_SEARCH_INPUT_TYPES.has(type)) return false;
  if (el.getAttribute('data-audit-search') !== null || type === 'search') return true;
  return SEARCH_PLACEHOLDER.test(el.getAttribute('placeholder') ?? '');
}

const VITAL_THRESHOLDS: Record<WebVitalName, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
  FCP: [1800, 3000],
};

export function vitalRating(name: WebVitalName, value: number): WebVitalRating {
  const [good, poor] = VITAL_THRESHOLDS[name];
  if (value <= good) return 'good';
  return value <= poor ? 'needs-improvement' : 'poor';
}

export function roundVital(name: WebVitalName, value: number): number {
  return name === 'CLS' ? Math.round(value * 10_000) / 10_000 : Math.round(value);
}

export function createAuditSessionId(): string {
  return createCorrelationId().replace(/-/g, '');
}
