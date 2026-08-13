const API_BASE = import.meta.env.VITE_API_URL ?? '';

let unauthorizedNotified = false;

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function assetUrl(
  path: string | null | undefined,
  cacheBust?: string | number | Date | null,
): string | null {
  if (!path) return null;

  let url = path;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `${API_BASE}${path}`;
  }

  if (cacheBust == null) return url;

  const version =
    cacheBust instanceof Date ? cacheBust.getTime() : String(cacheBust);
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  const isFormData = options.body instanceof FormData;
  const hasJsonBody = options.body != null && options.body !== '' && !isFormData;
  if (hasJsonBody) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new ApiError('Servidor indisponível. Execute npm run restart na raiz do projeto.', 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: null }));
    if (res.status === 401 && !path.startsWith('/api/auth/login')) {
      if (!unauthorizedNotified) {
        unauthorizedNotified = true;
        const { notifyUnauthorized } = await import('./auth-session.js');
        await notifyUnauthorized();
        unauthorizedNotified = false;
      }
    }
    const message =
      body.error ??
      (res.status === 502 || res.status === 503
        ? 'Backend offline. Execute npm run restart na raiz do projeto.'
        : `Erro na requisição (${res.status})`);
    throw new ApiError(message, res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  postFormData: <T>(path: string, body: FormData, opts?: { method?: 'POST' | 'PATCH' }) =>
    request<T>(path, { method: opts?.method ?? 'POST', body }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
};

export { ApiError };

export function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('pt-BR');
}

export function formatTime(time: string): string {
  return time.slice(0, 5);
}

export function formatEventoWhen(evento: {
  data: string | null;
  horaInicio: string;
  horaFim?: string | null;
  recorrencia?: string;
  diaSemana?: number | null;
}): string {
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  if (evento.recorrencia === 'SEMANAL' && evento.diaSemana != null) {
    const hora = formatTime(evento.horaInicio);
    const fim = evento.horaFim ? ` – ${formatTime(evento.horaFim)}` : '';
    return `Toda ${DIAS[evento.diaSemana]} · ${hora}${fim}`;
  }
  if (evento.data) {
    const hora = formatTime(evento.horaInicio);
    const fim = evento.horaFim ? ` – ${formatTime(evento.horaFim)}` : '';
    return `${formatDate(evento.data)} · ${hora}${fim}`;
  }
  return formatTime(evento.horaInicio);
}

export function formatMl(ml: number): string {
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)}L`;
  return `${ml}ml`;
}

/** Volume sempre em litros (ex.: 4,2 L · 0,50 L) */
export function formatLiters(ml: number): string {
  const liters = ml / 1000;
  const digits = liters >= 10 ? 1 : 2;
  return `${liters.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} L`;
}

export async function downloadCsv(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError('Erro ao exportar', res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
