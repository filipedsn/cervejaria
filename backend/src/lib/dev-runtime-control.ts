import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/** Windows launchers cannot deliver SIGTERM. This per-process capability is
 * injected by the DEV launcher, stored outside artifacts, and never logged. */
export function registerDevRuntimeControl(app: FastifyInstance, shutdown: () => Promise<void>): void {
  const token = process.env.QUIVER_DEV_SHUTDOWN_TOKEN;
  if (process.env.NODE_ENV !== 'development' || !token || !/^[a-f0-9]{32}$/.test(token)) return;
  app.post('/api/_dev/shutdown', async (request, reply) => {
    const provided = request.headers['x-quiver-dev-shutdown-token'];
    if (typeof provided !== 'string' || Buffer.byteLength(provided) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) return reply.code(404).send();
    reply.raw.once('finish', () => { setImmediate(() => void shutdown()); });
    return reply.code(202).send({ status: 'draining' });
  });
}
