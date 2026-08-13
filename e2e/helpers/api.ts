import type { Locator, Page } from '@playwright/test';

export const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:3002';

/** `/api/auth/login` tem rate limit; um token por e-mail basta para a suíte. */
const tokenCache = new Map<string, Promise<string>>();

/** Token de staff para preparar massa de teste sem passar pela UI. */
export function apiLogin(email: string, senha: string): Promise<string> {
  const cached = tokenCache.get(email);
  if (cached) return cached;

  const pending = (async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    if (!res.ok) throw new Error(`Login de API falhou para ${email}: HTTP ${res.status}`);
    const { token } = (await res.json()) as { token?: string };
    if (!token) throw new Error(`Login de API sem token para ${email}`);
    return token;
  })();

  tokenCache.set(email, pending);
  pending.catch(() => tokenCache.delete(email));
  return pending;
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
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
