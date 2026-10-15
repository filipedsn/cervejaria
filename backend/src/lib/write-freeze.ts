import { statSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const trackedRequests = new WeakSet<FastifyRequest>();
let inFlightWrites = 0;

function isAdministrativeSessionClosure(request: FastifyRequest) {
  if (request.method !== 'POST') return false;
  const pathname = new URL(request.url, 'http://localhost').pathname;
  return /^\/api\/operacao\/caixa\/sessoes\/[^/]+\/encerramento-administrativo$/.test(pathname);
}

function freezeFileState() {
  const file = process.env.QUIVER_WRITE_FREEZE_FILE?.trim();
  if (!file) return { blocked: false, configured: false };
  try {
    statSync(file);
    return { blocked: true, configured: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { blocked: false, configured: true };
    }
    // If the gate cannot be inspected, fail closed.
    return { blocked: true, configured: true };
  }
}

export function writeFreezeStatus() {
  return { ...freezeFileState(), inFlightWrites };
}

export function registerWriteFreezeGuard(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    if (!writeMethods.has(request.method)) return;
    const state = freezeFileState();
    if (state.blocked && !isAdministrativeSessionClosure(request)) {
      return reply
        .header('Retry-After', '60')
        .code(503)
        .send({ error: 'Escritas temporariamente bloqueadas para manutenção', code: 'WRITE_FREEZE_ACTIVE' });
    }
    trackedRequests.add(request);
    inFlightWrites += 1;
  });

  app.addHook('onResponse', async (request) => {
    if (!trackedRequests.delete(request)) return;
    inFlightWrites = Math.max(0, inFlightWrites - 1);
  });
}
