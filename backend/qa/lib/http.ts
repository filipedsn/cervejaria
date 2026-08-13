export const API_BASE = process.env.QA_API_BASE ?? 'http://localhost:3002';

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  durationMs: number;
  raw: string;
}

export interface PortalSessaoResult {
  status: number;
  cookie: string | null;
  /** Set-Cookie cru — necessário para inspecionar Max-Age, HttpOnly e SameSite. */
  setCookies: string[];
  comandaId: string | null;
  clienteId: string | null;
  durationMs: number;
  raw: string;
}

export interface PortalSessaoBody {
  nome: string;
  telefone: string;
}

export interface PortalPedidoBody {
  observacao?: string;
  itens: Array<{
    produtoId: string;
    volumeMl: number;
    quantidade?: number;
    tapId?: string;
  }>;
}

/** Extrai header Cookie `cliente_token=...` de Set-Cookie. */
export function parseClienteCookie(setCookieHeaders: string | string[] | null): string | null {
  if (!setCookieHeaders) return null;
  const parts = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const header of parts) {
    const match = header.match(/cliente_token=([^;]+)/);
    if (match) return `cliente_token=${match[1]}`;
  }
  return null;
}

export interface MultipartFile {
  fieldname: string;
  filename: string;
  contentType: string;
  content: Buffer | Uint8Array;
}

export interface MultipartPayload {
  fields?: Record<string, string | number | boolean>;
  files?: MultipartFile[];
}

function buildFormData(payload: MultipartPayload): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload.fields ?? {})) {
    form.append(key, String(value));
  }
  for (const file of payload.files ?? []) {
    const bytes = new Uint8Array(file.content);
    form.append(file.fieldname, new Blob([bytes], { type: file.contentType }), file.filename);
  }
  return form;
}

export async function api<T = unknown>(
  method: string,
  path: string,
  opts: {
    token?: string;
    rawToken?: string;
    cookie?: string;
    body?: unknown;
    /** Envia como multipart/form-data — o boundary fica por conta do fetch. */
    multipart?: MultipartPayload;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResponse<T>> {
  const start = performance.now();
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.rawToken !== undefined) headers.Authorization = opts.rawToken;
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let status = 0;
  let raw = '';
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: opts.multipart
        ? buildFormData(opts.multipart)
        : opts.body !== undefined
          ? JSON.stringify(opts.body)
          : undefined,
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

/**
 * Corpo em bytes crus. `Response.text()` remove o BOM UTF-8 por especificação,
 * então testar a presença do BOM exige ler o buffer.
 */
export async function apiBytes(
  method: string,
  path: string,
  opts: { token?: string } = {},
): Promise<{ status: number; bytes: Buffer; text: string; contentType: string | null }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(`${API_BASE}${path}`, { method, headers });
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    bytes,
    text: bytes.toString('utf-8'),
    contentType: res.headers.get('content-type'),
  };
}

export async function portalSessao(
  slug: string,
  trailerId: string,
  body: PortalSessaoBody,
): Promise<PortalSessaoResult> {
  const start = performance.now();
  let status = 0;
  let raw = '';
  let cookie: string | null = null;
  let setCookieHeaders: string[] = [];
  let comandaId: string | null = null;
  let clienteId: string | null = null;

  try {
    const res = await fetch(`${API_BASE}/api/public/cervejarias/${slug}/trailers/${trailerId}/sessao`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    status = res.status;
    raw = await res.text();
    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie')].filter((v): v is string => !!v);
    setCookieHeaders = setCookies;
    cookie = parseClienteCookie(setCookies.length ? setCookies : null);

    if (raw) {
      const parsed = JSON.parse(raw) as {
        cliente?: { id: string };
        comanda?: { id: string };
      };
      clienteId = parsed.cliente?.id ?? null;
      comandaId = parsed.comanda?.id ?? null;
    }
  } catch (err) {
    raw = err instanceof Error ? err.message : String(err);
  }

  return {
    status,
    cookie,
    setCookies: setCookieHeaders,
    comandaId,
    clienteId,
    durationMs: performance.now() - start,
    raw,
  };
}

export function portalPedidoBody(
  produtoId: string,
  tapId: string,
  volumeMl: number,
  observacao: string,
  quantidade = 1,
): PortalPedidoBody {
  return {
    observacao,
    itens: [{ produtoId, tapId, volumeMl, quantidade }],
  };
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

/** Telefone único de 11 dígitos para testes portal (prefixo + índice). */
export function portalTestPhone(prefix: number, index: number): string {
  return `11${String(prefix).padStart(2, '0')}${String(index).padStart(7, '0')}`;
}

/** Telefone único por execução (evita colisão entre runs da suíte QA). */
export function uniquePortalTestPhone(prefix: number, salt = 0): string {
  const idx = ((Date.now() + salt * 9973) % 9_000_000) + 1_000_000;
  return portalTestPhone(prefix, idx);
}

/** Body para POST /api/comandas (staff) com telefone válido. */
export function staffComandaBody(eventoId: string, nome: string, phoneIndex: number) {
  return {
    eventoId,
    clienteNome: nome,
    clienteTelefone: portalTestPhone(50, phoneIndex),
  };
}

/** Body staff com telefone único por execução (multi-tenant / runs repetidos). */
export function uniqueStaffComandaBody(eventoId: string, nome: string, salt = 0) {
  return {
    eventoId,
    clienteNome: nome,
    clienteTelefone: uniquePortalTestPhone(50, salt),
  };
}
