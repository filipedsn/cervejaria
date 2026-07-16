import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emitAuditEvent } from '../lib/audit/emit-audit-event.js';
import { describePageView, describeUiAction } from '../lib/audit/describe.js';
import { verifySession } from '../lib/session.js';
import { verifyClienteSession } from '../lib/cliente-session.js';

const uiEventSchema = z.object({
  type: z.enum(['click', 'page_view', 'submit']),
  page: z.string().min(1).max(500),
  element: z.string().max(200).optional(),
  label: z.string().max(300).optional(),
  timestamp: z.string().datetime().optional(),
  meta: z.record(z.unknown()).optional(),
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
      const label = event.label ?? event.element ?? event.type;
      const message =
        event.type === 'page_view'
          ? describePageView(event.page)
          : describeUiAction(label, event.page);

      emitAuditEvent({
        action: `ui.${event.type}`,
        message,
        outcome: 'success',
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
