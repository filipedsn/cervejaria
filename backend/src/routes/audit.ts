import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emitAuditEvent } from '../lib/audit/emit-audit-event.js';
import { describePageView, describeUiAction } from '../lib/audit/describe.js';
import { verifySession } from '../lib/session.js';
import { verifyClienteSession } from '../lib/cliente-session.js';
import { validCorrelationId } from '../lib/correlation-context.js';

function safeHttpText(value: string): boolean {
  return !/[\u0000-\u001F\u007F]/.test(value);
}

const httpTelemetrySchema = z.object({
  method: z.string().min(1).max(10).refine(safeHttpText, 'Método inválido'),
  route: z.string().min(1).max(500).refine(safeHttpText, 'Rota inválida'),
  statusCode: z.number().int().min(100).max(599).optional(),
  durationMs: z.number().finite().min(0).max(300_000),
  outcome: z.enum(['success', 'client_error', 'server_error', 'network_error', 'aborted', 'timeout']),
  correlationId: z.string().refine(validCorrelationId, 'Correlation ID inválido'),
  requestId: z.string().min(1).max(200).refine(safeHttpText, 'Request ID inválido').optional(),
});

const uiEventSchema = z.object({
  type: z.enum(['click', 'page_view', 'submit', 'error', 'http_request']),
  page: z.string().min(1).max(500),
  element: z.string().max(200).optional(),
  label: z.string().max(300).optional(),
  timestamp: z.string().datetime().optional(),
  meta: z.record(z.unknown()).optional(),
  http: httpTelemetrySchema.optional(),
});

const bodySchema = z.object({
  events: z.array(uiEventSchema).min(1).max(50),
});

export async function auditRoutes(app: FastifyInstance) {
  app.post('/events', async (request, reply) => {
    let staff = false;
    let cliente = false;

    try {
      await verifySession(app, request);
      staff = true;
    } catch {
      try {
        await verifyClienteSession(app, request);
        cliente = true;
      } catch {
        return reply.status(401).send({ error: 'Não autorizado' });
      }
    }

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Payload inválido' });
    }

    for (const event of parsed.data.events) {
      if (event.type === 'http_request' && event.http) {
        const outcome = event.http.outcome === 'success' ? 'success' : 'failure';
        emitAuditEvent({
          action: 'http.request.completed',
          message: `Requisição frontend ${event.http.method} ${event.http.route}: ${event.http.outcome}`,
          outcome,
          http: {
            method: event.http.method,
            route: event.http.route,
            statusCode: event.http.statusCode,
          },
          correlationId: event.http.correlationId,
          requestId: event.http.requestId,
          metadata: {
            source: staff ? 'staff' : cliente ? 'cliente' : 'unknown',
            durationMs: event.http.durationMs,
            outcome: event.http.outcome,
          },
        });
        continue;
      }

      const label = event.label ?? event.element ?? event.type;
      const message =
        event.type === 'page_view'
          ? describePageView(event.page)
          : event.type === 'error'
            ? `Erro na interface: ${label}`
            : describeUiAction(label, event.page);

      emitAuditEvent({
        action: `ui.${event.type}`,
        message,
        outcome: event.type === 'error' ? 'failure' : 'success',
        ui: {
          page: event.page,
          element: event.element,
          label: event.label ?? label,
        },
        metadata: {
          source: staff ? 'staff' : cliente ? 'cliente' : 'unknown',
          ...(event.meta ?? {}),
        },
      });
    }

    return reply.status(204).send();
  });
}
