import type { FastifyRequest } from 'fastify';
import { emitAuditEvent } from './audit/emit-audit-event.js';
import type { JwtPayload } from '../types/auth.js';

export type AuthReasonCode =
  | 'INVALID_CREDENTIALS'
  | 'SESSION_MISSING'
  | 'SESSION_INVALID'
  | 'SESSION_EXPIRED'
  | 'ROLE_DENIED'
  | 'TENANT_MISMATCH'
  | 'PORTAL_SESSION_INVALID';

type AuthAction =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.logout'
  | 'auth.session.rejected'
  | 'auth.authorization.denied';

type AuthUser = Pick<JwtPayload, 'nome' | 'papel' | 'cervejariaId'> & { sub?: string; id?: string };

function route(request: FastifyRequest): string {
  return request.routeOptions?.url ?? request.url.split('?')[0];
}

export function emitAuthEvent(
  request: FastifyRequest,
  action: AuthAction,
  options: { reasonCode?: AuthReasonCode; user?: AuthUser; role?: string } = {},
): void {
  const user = options.user ?? (request.user as JwtPayload | undefined);
  emitAuditEvent({
    action,
    message: action,
    outcome: action.endsWith('succeeded') || action === 'auth.logout' ? 'success' : 'failure',
    actor: user ? { type: 'usuario', id: ('sub' in user ? user.sub : user.id), name: user.nome } : undefined,
    http: { method: request.method, route: route(request) },
    metadata: { reasonCode: options.reasonCode, role: options.role ?? user?.papel },
  });
}

export function sessionReasonCode(error: unknown): AuthReasonCode {
  if (
    typeof error === 'object' &&
    error !== null &&
    'authReasonCode' in error &&
    (error as { authReasonCode?: unknown }).authReasonCode === 'PORTAL_SESSION_INVALID'
  ) {
    return 'PORTAL_SESSION_INVALID';
  }
  if (error instanceof Error && error.name === 'ClienteSessionValidationError') {
    return 'PORTAL_SESSION_INVALID';
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('expirada')) return 'SESSION_EXPIRED';
  if (message.includes('ausente') || message.includes('missing')) return 'SESSION_MISSING';
  return 'SESSION_INVALID';
}
