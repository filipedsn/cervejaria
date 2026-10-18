import type { FastifyInstance } from 'fastify';
import { CanonicalPdvConfigurationError, canonicalPdvQaActivationEnabled } from './canonical-pdv-operational-config.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const LEGACY_WRITE_BLOCKED_CODE = 'CANONICAL_PDV_LEGACY_WRITE_BLOCKED';
const LEGACY_WRITE_BLOCKED_MESSAGE = 'Operação do modelo antigo desativada. Use as telas de Operação do ponto de venda.';

export function assertLegacyWriteAllowed(method: string, tenantId?: string, env: NodeJS.ProcessEnv = process.env): void {
  if (READ_METHODS.has(method.toUpperCase())) return;
  if (canonicalPdvQaActivationEnabled(env, tenantId)) {
    throw new CanonicalPdvConfigurationError(LEGACY_WRITE_BLOCKED_CODE, LEGACY_WRITE_BLOCKED_MESSAGE);
  }
}

/** Register after authentication so the tenant of the session is known. Reads stay available for history. */
export function registerLegacyWriteGuard(app: FastifyInstance): void {
  app.addHook('preHandler', async (request) => {
    assertLegacyWriteAllowed(request.method, request.user?.cervejariaId ?? undefined);
  });
}
