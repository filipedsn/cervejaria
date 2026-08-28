import type { Locator, Page } from '@playwright/test';

export const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:3002';

/** `/api/auth/login` tem rate limit; uma sessão por e-mail basta para a suíte. */
const sessionCookieCache = new Map<string, Promise<string>>();

/** Cookie HttpOnly de staff para preparar massa de teste sem passar pela UI. */
export function apiLogin(email: string, senha: string): Promise<string> {
  const cached = sessionCookieCache.get(email);
  if (cached) return cached;

  const pending = (async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    if (!res.ok) throw new Error(`Login de API falhou para ${email}: HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    if ('token' in body) throw new Error(`Login de API expôs token no body para ${email}`);
    const setCookie = res.headers.get('set-cookie');
    const match = setCookie?.match(/(?:^|,\s*)token=([^;]+)/);
    if (!match) throw new Error(`Login de API sem cookie de sessão para ${email}`);
    return `token=${match[1]}`;
  })();

  sessionCookieCache.set(email, pending);
  pending.catch(() => sessionCookieCache.delete(email));
  return pending;
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown } = {},
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const raw = await res.text();
  let data: T;
  try {
    data = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    data = { raw } as T;
  }
  return { status: res.status, data };
}

/**
 * Os formulários do app usam `<label class="label">` como irmão do campo, sem
 * `htmlFor`, então `getByLabel` não enxerga a associação — daí o seletor por
 * irmão adjacente.
 */
export function campoPorRotulo(scope: Page | Locator, rotulo: string): Locator {
  return scope.locator(`label:text-is("${rotulo}") + input`);
}

export function selectPorRotulo(scope: Page | Locator, rotulo: string): Locator {
  return scope.locator(`label:text-is("${rotulo}") + select`);
}
