import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const context = new AsyncLocalStorage<FastifyRequest>();
const resolvedPublicTenant = new WeakMap<FastifyRequest, string>();
const allowed = new Set(['cmr9yis3c0000hvu00q9fe7y1', 'cmsry9xrn0000hvlgopjxy0oo']);

export function registerPdvTenantContext(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => context.run(request, done));
}

export function bindResolvedPdvTenant(tenantId: string): void {
  const request = context.getStore();
  if (request && !request.user?.cervejariaId) resolvedPublicTenant.set(request, tenantId);
}

/** Undefined means the old, explicitly opted-in QA test harness. */
export function tenantPdvActivation(tenantId?: string, env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  if (env.PDV_CANONICAL_TENANTS === undefined) return undefined;
  const ids = env.PDV_CANONICAL_TENANTS.split(',').filter(Boolean);
  if (ids.some(id => !allowed.has(id)) || new Set(ids).size !== ids.length) throw new Error('Invalid PDV tenant activation allowlist.');
  const target = new URL(env.DATABASE_URL ?? '');
  const dev = env.NODE_ENV === 'development' && !env.PDV_ISOLATED_QA && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && target.port === '5434' && target.pathname === '/cervejaria_dev';
  const qa = env.PDV_ISOLATED_QA === '1' && env.QA_DATABASE_URL === env.DATABASE_URL && target.hostname === '127.0.0.1' && Number(target.port) >= 55439 && Number(target.port) <= 55449 && target.pathname === '/cervejaria_qa_pdv_unico';
  if ((!dev && !qa) || !['postgres:', 'postgresql:'].includes(target.protocol) || Object.keys(env).some(key => /^PROD(?:_|$)/i.test(key))) throw new Error('Invalid PDV activation destination.');
  const request = context.getStore();
  const id = request?.user?.cervejariaId ?? tenantId ?? (request ? resolvedPublicTenant.get(request) : undefined);
  return Boolean(id && ids.includes(id));
}
