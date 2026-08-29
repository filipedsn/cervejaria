import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';

function routeTemplate(request: FastifyRequest): string {
  return request.routeOptions?.url ?? request.url.split('?')[0] ?? request.url;
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  return new Error('Erro interno do servidor');
}

/** One structured event for an unexpected 5xx; Fastify still owns the normal request-complete log. */
export function logUnhandledRequestError(
  logger: FastifyBaseLogger,
  request: FastifyRequest,
  reply: FastifyReply,
  cause: unknown,
): void {
  logger.error(
    {
      err: asError(cause),
      requestId: request.id,
      correlationId: request.correlationId,
      method: request.method,
      route: routeTemplate(request),
      statusCode: 500,
      durationMs: Math.round(reply.elapsedTime),
    },
    'Unhandled request error',
  );
}
