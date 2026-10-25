import { trackHttpRequest, type HttpRequestOutcome } from './audit-tracker';
import { CORRELATION_ID_HEADER, createCorrelationId, isCorrelationId } from './correlation-id';
import { currentInteractionId, INTERACTION_ID_HEADER } from './interaction-context';

const API_BASE = import.meta.env?.VITE_API_URL ?? '';

let unauthorizedNotified = false;

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: Record<string, unknown>,
    public correlationId?: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

export function logoAssetUrl(
  cervejaria?: {
    logoUrl?: string | null;
    logoVersion?: string | null;
    updatedAt?: string | null;
  } | null,
): string | null {
  return assetUrl(cervejaria?.logoUrl, cervejaria?.logoVersion ?? cervejaria?.updatedAt);
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

export function buildRequestHeaders(options: RequestInit = {}): Record<string, string> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  const isFormData = options.body instanceof FormData;
  const hasJsonBody = options.body != null && options.body !== '' && !isFormData;
  if (hasJsonBody) {
    headers['Content-Type'] = 'application/json';
  }
  headers[CORRELATION_ID_HEADER] = createCorrelationId();
  const interactionId = currentInteractionId();
  if (interactionId) headers[INTERACTION_ID_HEADER] = interactionId;
  return headers;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function sanitizedRoute(path: string): string {
  try {
    return new URL(path, 'http://frontend.local').pathname;
  } catch {
    return path.split('?')[0] || '/';
  }
}

function responseOutcome(statusCode: number): HttpRequestOutcome {
  if (statusCode < 400) return 'success';
  if (statusCode < 500) return 'client_error';
  return 'server_error';
}

function fetchFailureOutcome(error: unknown): HttpRequestOutcome {
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  return 'network_error';
}

function reportHttpRequest(input: {
  method: string;
  path: string;
  statusCode?: number;
  outcome: HttpRequestOutcome;
  startedAt: number;
  correlationId: string;
  requestId?: string;
  interactionId?: string;
}): void {
  try {
    trackHttpRequest({
      method: input.method,
      route: sanitizedRoute(input.path),
      statusCode: input.statusCode,
      durationMs: Math.max(0, Math.round(now() - input.startedAt)),
      outcome: input.outcome,
      correlationId: input.correlationId,
      requestId: input.requestId,
      interactionId: input.interactionId,
    });
  } catch {
    // Observability is fail-open: a local telemetry failure never affects API behavior.
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = buildRequestHeaders(options);
  const correlationId = headers[CORRELATION_ID_HEADER];
  const interactionId = headers[INTERACTION_ID_HEADER];
  const method = (options.method ?? 'GET').toUpperCase();
  const startedAt = now();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    reportHttpRequest({
      method,
      path,
      outcome: fetchFailureOutcome(error),
      startedAt,
      correlationId,
      interactionId,
    });
    throw new ApiError('Servidor indisponível. Execute npm run restart na raiz do projeto.', 0, undefined, correlationId);
  }

  const returnedCorrelationId = res.headers.get(CORRELATION_ID_HEADER);
  const responseCorrelationId = isCorrelationId(returnedCorrelationId)
    ? returnedCorrelationId
    : correlationId;
  const responseRequestId = res.headers.get('x-request-id') ?? undefined;
  const complete = (outcome: HttpRequestOutcome) => reportHttpRequest({
    method,
    path,
    statusCode: res.status,
    outcome,
    startedAt,
    correlationId: responseCorrelationId,
    requestId: responseRequestId,
    interactionId,
  });

  if (!res.ok) {
    complete(responseOutcome(res.status));
    const body = await res.json().catch(() => ({ error: null }));
    // Client-portal 401 responses belong to its anonymous session, never to
    // the staff session that controls the internal-login redirect.
    if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/public/')) {
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
    throw new ApiError(message, res.status, body, responseCorrelationId, responseRequestId);
  }

  if (res.status === 204) { complete('success'); return undefined as T; }
  try {
    const result = await res.json();
    complete('success');
    return result;
  } catch {
    complete('invalid_response');
    throw new ApiError(
      'Resposta inválida do servidor.',
      res.status,
      undefined,
      responseCorrelationId,
      responseRequestId,
    );
  }
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

function formatDateOnly(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return formatDate(date);
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR');
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
    return `${formatDateOnly(evento.data)} · ${hora}${fim}`;
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
  const headers = buildRequestHeaders();
  const correlationId = headers[CORRELATION_ID_HEADER];
  const startedAt = now();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers,
    });
  } catch (error) {
    reportHttpRequest({
      method: 'GET',
      path,
      outcome: fetchFailureOutcome(error),
      startedAt,
      correlationId,
      interactionId: headers[INTERACTION_ID_HEADER],
    });
    throw error;
  }

  const returnedCorrelationId = res.headers.get(CORRELATION_ID_HEADER);
  const responseCorrelationId = isCorrelationId(returnedCorrelationId)
    ? returnedCorrelationId
    : correlationId;
  reportHttpRequest({
    method: 'GET',
    path,
    statusCode: res.status,
    outcome: responseOutcome(res.status),
    startedAt,
    correlationId: responseCorrelationId,
    requestId: res.headers.get('x-request-id') ?? undefined,
    interactionId: headers[INTERACTION_ID_HEADER],
  });

  if (!res.ok) throw new ApiError('Erro ao exportar', res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
