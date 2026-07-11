export const API_BASE = process.env.QA_API_BASE ?? 'http://localhost:3002';

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  durationMs: number;
  raw: string;
}

export async function api<T = unknown>(
  method: string,
  path: string,
  opts: {
    token?: string;
    rawToken?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResponse<T>> {
  const start = performance.now();
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.rawToken !== undefined) headers.Authorization = opts.rawToken;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let status = 0;
  let raw = '';
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    status = res.status;
    raw = await res.text();
  } catch (err) {
    return {
      status: 0,
      data: { error: err instanceof Error ? err.message : String(err) } as T,
      durationMs: performance.now() - start,
      raw: '',
    };
  }

  let data: T;
  try {
    data = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    data = { raw } as T;
  }
  return { status, data, durationMs: performance.now() - start, raw };
}

export async function login(email: string, senha: string): Promise<string> {
  const res = await api<{ token: string }>('POST', '/api/auth/login', {
    body: { email, senha },
  });
  if (res.status !== 200 || !res.data.token) {
    throw new Error(`Login falhou para ${email}: HTTP ${res.status} ${res.raw.slice(0, 120)}`);
  }
  return res.data.token;
}

export function chopeItemBody(
  produtoId: string,
  tapId: string,
  volumeMl: number,
  quantidade = 1,
) {
  return { produtoId, tapId, volumeMl, quantidade };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}
