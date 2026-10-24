import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const INTERACTION_ID_HEADER = 'x-interaction-id';

// UUIDs are short, printable and safe to add to structured logs and response headers.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    interactionId?: string;
  }
}

export function validCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && UUID_PATTERN.test(value);
}

export function resolveCorrelationId(value: unknown): string {
  return validCorrelationId(value) ? value.toLowerCase() : randomUUID();
}

/** Establishes an ID before authentication, handlers and error handling run. */
export function registerCorrelationContext(app: FastifyInstance): void {
  app.decorateRequest('correlationId', '');
  app.decorateRequest('interactionId', undefined);
  app.addHook('onRequest', async (request, reply) => {
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_ID_HEADER]);
    request.correlationId = correlationId;
    const interaction = request.headers[INTERACTION_ID_HEADER];
    request.interactionId = validCorrelationId(interaction) ? interaction.toLowerCase() : undefined;
    reply.header(CORRELATION_ID_HEADER, correlationId);
  });
}
