import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const context = new AsyncLocalStorage<FastifyRequest>();
const resolvedPublicTenant = new WeakMap<FastifyRequest, string>();

export function registerPdvTenantContext(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => context.run(request, done));
}

export function bindResolvedPdvTenant(tenantId: string): void {
  const request = context.getStore();
  if (request && !request.user?.cervejariaId) resolvedPublicTenant.set(request, tenantId);
}

export function canonicalPdvGloballyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PDV_CANONICAL_ALL === '1';
}

function assertActivationDestination(env: NodeJS.ProcessEnv): void {
  let target: URL;
  try {
    target = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('Invalid PDV activation destination.');
  }
  const dev = env.NODE_ENV === 'development' && !env.PDV_ISOLATED_QA && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && target.port === '5434' && target.pathname === '/cervejaria_dev';
  const qa = ['development', 'test'].includes(env.NODE_ENV ?? '') && env.PDV_ISOLATED_QA === '1' && env.QA_DATABASE_URL === env.DATABASE_URL && target.hostname === '127.0.0.1' && Number(target.port) >= 55439 && Number(target.port) <= 55449 && target.pathname === '/cervejaria_qa_pdv_unico';
  const production = env.NODE_ENV === 'production'
    && !env.PDV_ISOLATED_QA
    && !env.QA_DATABASE_URL
    && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    && (target.port === '' || target.port === '5432')
    && target.pathname === '/cervejaria';
  const productionMarkerOutsideProduction = !production && Object.keys(env).some(key => /^PROD(?:_|$)/i.test(key));
  if ((!dev && !qa && !production) || !['postgres:', 'postgresql:'].includes(target.protocol) || productionMarkerOutsideProduction) throw new Error('Invalid PDV activation destination.');
}

/**
 * `PDV_CANONICAL_ALL=1` activates the single-PDV model for every tenant.
 * `PDV_CANONICAL_TENANTS` remains as a per-tenant selector for the older
 * disposable QA harnesses. Undefined means neither is configured.
 */
export function tenantPdvActivation(tenantId?: string, env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  const global = canonicalPdvGloballyEnabled(env);
  if (!global && env.PDV_CANONICAL_TENANTS === undefined) return undefined;
  const ids = global ? [] : (env.PDV_CANONICAL_TENANTS ?? '').split(',').map(id => id.trim()).filter(Boolean);
  if (!global && (ids.length === 0 || new Set(ids).size !== ids.length || ids.some(id => !/^[a-z0-9]{20,40}$/.test(id)))) {
    throw new Error('Invalid PDV tenant activation selector.');
  }
  assertActivationDestination(env);
  if (global) return true;
  const request = context.getStore();
  const id = tenantId ?? request?.user?.cervejariaId ?? (request ? resolvedPublicTenant.get(request) : undefined);
  return Boolean(id && ids.includes(id));
}
