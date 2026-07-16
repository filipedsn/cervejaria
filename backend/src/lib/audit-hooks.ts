import type { FastifyInstance, FastifyRequest } from 'fastify';
import { redactObject } from './audit/redact.js';
import { describeHttpAction } from './audit/describe.js';
import { emitAuditEvent } from './audit/emit-audit-event.js';
import {
  applyTelemetryContext,
  enterTelemetryContext,
  resolveTelemetryFromRequest,
  runWithTelemetryContext,
} from './telemetry-context.js';

const SKIP_AUDIT_PREFIXES = [
  '/uploads/',
  '/assets/',
  '/icons/',
  '/api/health',
  '/api/ready',
  '/api/audit/events',
];

function shouldSkipAudit(url: string): boolean {
  if (SKIP_AUDIT_PREFIXES.some((p) => url.startsWith(p))) return true;
  if (url.includes('.') && !url.startsWith('/api/')) return true;
  return false;
}

function routeTemplate(request: FastifyRequest): string {
  return request.routeOptions?.url ?? request.url.split('?')[0] ?? request.url;
}

export function registerAuditHooks(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (shouldSkipAudit(request.url)) return;

    const ctx = await resolveTelemetryFromRequest(request);
    enterTelemetryContext(ctx);
    applyTelemetryContext(ctx);
    (request as FastifyRequest & { telemetryCtx?: typeof ctx }).telemetryCtx = ctx;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (shouldSkipAudit(request.url)) return;

    const ctx =
      (request as FastifyRequest & { telemetryCtx?: Awaited<ReturnType<typeof resolveTelemetryFromRequest>> })
        .telemetryCtx ?? (await resolveTelemetryFromRequest(request));

    runWithTelemetryContext(ctx, () => {
      const method = request.method;
      const route = routeTemplate(request);
      const statusCode = reply.statusCode;
      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
      const isApi = route.startsWith('/api/');

      if (!isApi) return;

      const message = describeHttpAction(method, route, statusCode);
      const outcome = statusCode >= 400 ? 'failure' : 'success';

      if (method.toUpperCase() === 'GET' && statusCode < 400) {
        emitAuditEvent({
          action: `http.${method.toLowerCase()}`,
          message,
          outcome,
          http: { method, route, statusCode },
        });
        return;
      }

      if (mutating || statusCode >= 400) {
        const body =
          request.body && typeof request.body === 'object'
            ? (redactObject(request.body) as Record<string, unknown>)
            : undefined;
        emitAuditEvent({
          action: `http.${method.toLowerCase()}`,
          message,
          outcome,
          http: { method, route, statusCode },
          metadata: body ? { requestBody: body } : undefined,
        });
      }
    });
  });
}
