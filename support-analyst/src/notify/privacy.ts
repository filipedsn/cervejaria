import type { ErrorContext } from '../watch/types.js';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const IPV6_FULL = /(?<![\w:])(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}(?![\w:])/gi;
const IPV6_COMPRESSED = /(?<![\w:])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?(?![\w:])/gi;
const TECHNICAL_ID = /^[A-Za-z0-9._:-]{1,100}$/;

/** Last line of defense for Telegram text: e-mails and IP addresses never leave the PC. */
export function scrubPersonalData(text: string): string {
  return text
    .replace(EMAIL, '[e-mail omitido]')
    .replace(IPV6_FULL, '[ip omitido]')
    .replace(IPV6_COMPRESSED, '[ip omitido]')
    .replace(IPV4, '[ip omitido]');
}

/** Route template only: numeric ids, UUIDs and long tokens become :id; query strings are dropped. */
export function routeTemplate(value: string): string | undefined {
  const path = value.split(/[?#]/)[0]?.trim() ?? '';
  if (!path.startsWith('/') || path.length > 200) return undefined;
  return scrubPersonalData(path
    .split('/')
    .map((segment) => (/^\d+$/.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment) || /^[A-Za-z0-9_-]{24,}$/.test(segment) ? ':id' : segment))
    .join('/'));
}

/**
 * Builds the only context a Telegram message may carry from an arbitrary object: counts per route
 * template and technical correlation ids. Names, e-mails, IPs, cities and search terms are dropped
 * structurally because they are never read.
 */
export function toSafeErrorContext(raw: unknown): ErrorContext {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const routes = Array.isArray(record.routes) ? record.routes : [];
  const correlationIds = Array.isArray(record.correlationIds) ? record.correlationIds : [];
  return {
    routes: routes.flatMap((item) => {
      const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const route = typeof entry.route === 'string' ? routeTemplate(entry.route) : undefined;
      const count = typeof entry.count === 'number' && Number.isSafeInteger(entry.count) && entry.count >= 0 ? entry.count : undefined;
      return route && count !== undefined ? [{ route, count }] : [];
    }).slice(0, 5),
    correlationIds: correlationIds.filter((id): id is string => typeof id === 'string' && TECHNICAL_ID.test(id) && scrubPersonalData(id) === id).slice(0, 3),
  };
}
