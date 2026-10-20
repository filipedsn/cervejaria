import type { FastifyInstance, FastifyRequest } from 'fastify';
import { redactObject } from './audit/redact.js';
import { describeHttpAction } from './audit/describe.js';
import { emitAuditEvent } from './audit/emit-audit-event.js';
import type { AuditEventInput } from './audit/emit-audit-event.js';
import {
  applyTelemetryContext,
  enterTelemetryContext,
  resolveTelemetryFromRequest,
  runWithTelemetryContext,
} from './telemetry-context.js';

/** Skip total — sem contexto de telemetria nem audit HTTP. */
const SKIP_ALWAYS_PREFIXES = [
  '/uploads/',
  '/assets/',
  '/icons/',
  '/api/health',
  '/api/ready',
  '/api/audit/events',
  '/api/observability/kibana-alert',
];

/** Skip apenas GET (polling); mutações continuam auditadas. */
const SKIP_GET_ONLY_PREFIXES = [
  '/api/operacao/cozinha',
  '/api/pedidos/eventos/',
  '/api/ranking/',
  '/api/public/cliente/',
];

function shouldSkipAudit(url: string, method?: string): boolean {
  if (SKIP_ALWAYS_PREFIXES.some((p) => url.startsWith(p))) return true;
  const m = (method ?? 'GET').toUpperCase();
  if (m === 'GET' && SKIP_GET_ONLY_PREFIXES.some((p) => url.startsWith(p))) return true;
  if (url.includes('.') && !url.startsWith('/api/')) return true;
  return false;
}

// UI audit events emit their own records, so they need context even though we do
// not create a second HTTP audit event for the batch endpoint.
function shouldInitializeTelemetry(url: string, method?: string): boolean {
  return !shouldSkipAudit(url, method) || url.startsWith('/api/audit/events');
}

/** 401 em /api/auth/me é esperado (cookie expirado ao reabrir aba). */
function shouldSkipHttpAudit(route: string, method: string, statusCode: number): boolean {
  if (route === '/api/auth/me' && method.toUpperCase() === 'GET' && statusCode === 401) {
    return true;
  }
  return false;
}

function routeTemplate(request: FastifyRequest): string {
  return request.routeOptions?.url ?? request.url.split('?')[0] ?? request.url;
}

type AuditRequest = FastifyRequest & {
  telemetryCtx?: Awaited<ReturnType<typeof resolveTelemetryFromRequest>>;
  auditResponseError?: Record<string, unknown>;
};

function parseResponseError(payload: unknown): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  try {
    const parsed =
      typeof payload === 'string'
        ? (JSON.parse(payload) as Record<string, unknown>)
        : (payload as Record<string, unknown>);
    if (parsed && typeof parsed.error === 'string') {
      const out: Record<string, unknown> = { error: parsed.error };
      if (parsed.comandaId != null) out.comandaId = parsed.comandaId;
      if (parsed.clienteId != null) out.clienteId = parsed.clienteId;
      return out;
    }
  } catch {
    /* ignore non-JSON payloads */
  }
  return undefined;
}

export function registerAuditHooks(
  app: FastifyInstance,
  emit: (input: AuditEventInput) => void = emitAuditEvent,
): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!shouldInitializeTelemetry(request.url, request.method)) return;

    const ctx = await resolveTelemetryFromRequest(request);
    enterTelemetryContext(ctx);
    applyTelemetryContext(ctx);
    (request as AuditRequest).telemetryCtx = ctx;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode >= 400) {
      const err = parseResponseError(payload);
      if (err) (request as AuditRequest).auditResponseError = err;
    }
    return payload;
  });

  // Fastify executes handlers in a distinct async chain from onRequest. Re-enter
  // the stored context at the last common hook so handler logs and emitted audit
  // events inherit it as well.
  app.addHook('preHandler', async (request) => {
    if (!shouldInitializeTelemetry(request.url, request.method)) return;

    const req = request as AuditRequest;
    const ctx = req.telemetryCtx ?? (await resolveTelemetryFromRequest(request));
    req.telemetryCtx = ctx;
    enterTelemetryContext(ctx);
    applyTelemetryContext(ctx);
  });

  app.addHook('onResponse', async (request, reply) => {
    if (shouldSkipAudit(request.url, request.method)) return;

    const req = request as AuditRequest;
    const ctx = req.telemetryCtx ?? (await resolveTelemetryFromRequest(request));

    runWithTelemetryContext(ctx, () => {
      const method = request.method;
      const route = routeTemplate(request);
      const statusCode = reply.statusCode;
      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
      const isApi = route.startsWith('/api/');

      if (!isApi) return;

      if (shouldSkipHttpAudit(route, method, statusCode)) return;

      const message = describeHttpAction(method, route, statusCode);
      const outcome = statusCode >= 400 ? 'failure' : 'success';

      // Polling de alto volume já está excluído acima. Audite demais leituras
      // sem query/body, preservando rota parametrizada, resultado e duração.
      if (method.toUpperCase() === 'GET' && statusCode < 400) {
        emit({
          action: 'http.get',
          message,
          outcome,
          http: { method, route, statusCode, durationMs: Math.round(reply.elapsedTime) },
        });
        return;
      }

      if (mutating || statusCode >= 400) {
        const body =
          request.body && typeof request.body === 'object'
            ? (redactObject(request.body) as Record<string, unknown>)
            : undefined;
        const metadata: Record<string, unknown> = {};
        if (body) metadata.requestBody = body;
        if (req.auditResponseError) metadata.responseError = req.auditResponseError;

        emit({
          action: `http.${method.toLowerCase()}`,
          message,
          outcome,
          http: { method, route, statusCode, durationMs: Math.round(reply.elapsedTime) },
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        });
      }
    });
  });
}
