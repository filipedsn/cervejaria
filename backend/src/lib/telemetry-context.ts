import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyRequest } from 'fastify';
import { trace } from '@opentelemetry/api';
import type { JwtPayload } from '../types/auth.js';
import {
  isClienteSessionPayload,
  CLIENTE_COOKIE_NAME,
  type ClienteSessionPayload,
  type PdvClienteSessionPayload,
} from '../types/cliente-session.js';
import { getReleaseContext } from './release-context.js';
import { readPdvClienteSession } from './pdv-client-session.js';
import { trustedGeoCountryForRequest } from './trusted-geolocation.js';

export type AuditActorType = 'usuario' | 'cliente' | 'cliente-pdv' | 'system' | 'anonymous';

export type TelemetryActor = {
  type: AuditActorType;
  id?: string;
  role?: string;
  clienteId?: string;
};

export type TelemetryContext = {
  /** Fastify's per-request ID, separate from the logical correlation ID. */
  requestId?: string;
  correlationId?: string;
  /** Untrusted navigation aid only; never used for authorization or tenancy. */
  interactionId?: string;
  cervejariaId?: string;
  slug: string;
  env: 'dev' | 'prd';
  actor: TelemetryActor;
  /** ISO country only; no client IP is retained. */
  clientCountryCode?: string;
};

const storage = new AsyncLocalStorage<TelemetryContext>();

const slugCache = new Map<string, { slug: string; expiresAt: number }>();
const publicTenantCache = new Map<string, { id: string; slug: string; expiresAt: number } | { expiresAt: number }>();
const SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
const PUBLIC_TENANT_CACHE_TTL_MS = 60 * 1000;
const PUBLIC_TENANT_CACHE_LIMIT = 512;

export function getObservabilityEnv(): 'dev' | 'prd' {
  return process.env.NODE_ENV === 'production' ? 'prd' : 'dev';
}

export function sanitizeSlugForIndex(slug: string): string {
  return slug
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'unknown';
}

export function logsIndexDataset(slug: string): string {
  return sanitizeSlugForIndex(slug);
}

export function runWithTelemetryContext<T>(ctx: TelemetryContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Mantém contexto OTel/audit durante toda a requisição Fastify. */
export function enterTelemetryContext(ctx: TelemetryContext): void {
  storage.enterWith(ctx);
}

export function getTelemetryContext(): TelemetryContext | undefined {
  return storage.getStore();
}

export function getTelemetryContextOrDefault(): TelemetryContext {
  return (
    storage.getStore() ?? {
      slug: 'system',
      env: getObservabilityEnv(),
      actor: { type: 'system' },
    }
  );
}

async function resolveSlugByCervejariaId(cervejariaId: string): Promise<string | undefined> {
  const cached = slugCache.get(cervejariaId);
  if (cached && cached.expiresAt > Date.now()) return cached.slug;

  const { prisma } = await import('./prisma.js');
  const row = await prisma.cervejaria.findUnique({
    where: { id: cervejariaId },
    select: { slug: true },
  });
  if (!row?.slug) return undefined;

  slugCache.set(cervejariaId, { slug: row.slug, expiresAt: Date.now() + SLUG_CACHE_TTL_MS });
  return row.slug;
}

function slugFromPublicPath(url: string): string | undefined {
  const match = url.match(/\/api\/public\/cervejarias\/([^/?]+)/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

async function resolvePublicTenant(slug: string): Promise<{ id: string; slug: string } | undefined> {
  const normalized = slug.toLowerCase();
  const cached = publicTenantCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return 'id' in cached ? { id: cached.id, slug: cached.slug } : undefined;
  }

  const { prisma } = await import('./prisma.js');
  const row = await prisma.cervejaria.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (publicTenantCache.size >= PUBLIC_TENANT_CACHE_LIMIT) {
    const oldest = publicTenantCache.keys().next().value;
    if (oldest) publicTenantCache.delete(oldest);
  }
  const expiresAt = Date.now() + PUBLIC_TENANT_CACHE_TTL_MS;
  publicTenantCache.set(normalized, row ? { id: row.id, slug: row.slug, expiresAt } : { expiresAt });
  return row ? { id: row.id, slug: row.slug } : undefined;
}

export type TelemetryTenantResolver = {
  byId: typeof resolveSlugByCervejariaId;
  byPublicSlug: typeof resolvePublicTenant;
};

export type ClienteSessionKind = 'legacy' | 'pdv';

export function publicPortalKind(path: string): ClienteSessionKind | undefined {
  const pathname = path.split('?')[0] ?? path;
  if (/^\/c\/[^/]+\/p\/[^/]+(?:\/|$)/.test(pathname)) return 'pdv';
  if (/^\/c\/[^/]+\/t\/[^/]+(?:\/|$)/.test(pathname)) return 'legacy';
  if (/^\/api\/public\/cervejarias\/[^/]+\/pontos-venda(?:\/|$)/.test(pathname)) return 'pdv';
  if (/^\/api\/public\/cervejarias\/[^/]+(?:\/|$)/.test(pathname)) return 'legacy';
  if (/^\/api\/public\/cliente(?:\/|$)/.test(pathname)) return 'legacy';
  return undefined;
}

const defaultTenantResolver: TelemetryTenantResolver = {
  byId: resolveSlugByCervejariaId,
  byPublicSlug: resolvePublicTenant,
};

export async function resolveTelemetryFromClienteSession(
  request: FastifyRequest,
  session: ClienteSessionPayload | PdvClienteSessionPayload,
  tenantResolver: TelemetryTenantResolver = defaultTenantResolver,
): Promise<TelemetryContext> {
  const slug = (await tenantResolver.byId(session.cervejariaId)) ?? 'unknown';
  const actor: TelemetryActor =
    session.type === 'cliente-pdv'
      ? { type: 'cliente-pdv', id: session.clienteId, clienteId: session.clienteId }
      : { type: 'cliente', id: session.clienteId, clienteId: session.clienteId };
  return {
    requestId: request.id,
    correlationId: request.correlationId,
    interactionId: request.interactionId,
    cervejariaId: session.cervejariaId,
    slug,
    env: getObservabilityEnv(),
    actor,
  };
}

async function resolvePublicRequestContext(
  request: FastifyRequest,
  kind: ClienteSessionKind,
  tenantResolver: TelemetryTenantResolver,
): Promise<TelemetryContext> {
  if (kind === 'pdv') {
    const session = await readPdvClienteSession(request.server, request);
    if (session) return resolveTelemetryFromClienteSession(request, session, tenantResolver);
  } else {
    const token = request.cookies?.[CLIENTE_COOKIE_NAME];
    if (token && request.server?.jwt) {
      try {
        const decoded = await request.server.jwt.verify(token);
        if (isClienteSessionPayload(decoded)) {
          return resolveTelemetryFromClienteSession(request, decoded, tenantResolver);
        }
      } catch {
        // Invalid customer cookies remain anonymous on public routes.
      }
    }
  }

  const publicSlug = slugFromPublicPath(request.url);
  const tenant = publicSlug ? await tenantResolver.byPublicSlug(publicSlug) : undefined;
  return {
    requestId: request.id,
    correlationId: request.correlationId,
    cervejariaId: tenant?.id,
    slug: tenant?.slug ?? 'unknown',
    env: getObservabilityEnv(),
    actor: { type: 'anonymous' },
  };
}

function actorFromJwtUser(user: JwtPayload): TelemetryActor {
  return {
    type: user.papel === 'ADMIN' ? 'system' : 'usuario',
    id: user.sub,
    role: user.papel,
  };
}

export async function resolveTelemetryFromRequest(
  request: FastifyRequest,
  tenantResolver: TelemetryTenantResolver = defaultTenantResolver,
): Promise<TelemetryContext> {
  const env = getObservabilityEnv();
  const publicSlug = slugFromPublicPath(request.url);
  const geo = trustedGeoCountryForRequest({
    remoteAddress: request.raw?.socket?.remoteAddress,
    headers: request.headers ?? {},
  });
  const requestContext = {
    requestId: request.id,
    correlationId: request.correlationId,
    interactionId: request.interactionId,
    ...(geo.countryCode ? { clientCountryCode: geo.countryCode } : {}),
  };

  const publicKind = publicPortalKind(request.url);
  if (publicKind) return { ...(await resolvePublicRequestContext(request, publicKind, tenantResolver)), ...requestContext };

  let user = request.user as JwtPayload | undefined;
  if (!user) {
    try {
      await request.jwtVerify();
      user = request.user as JwtPayload;
    } catch {
      user = undefined;
    }
  }

  if (user?.cervejariaId) {
    const slug = (await tenantResolver.byId(user.cervejariaId)) ?? 'unknown';
    return {
      ...requestContext,
      cervejariaId: user.cervejariaId,
      slug,
      env,
      actor: actorFromJwtUser(user),
    };
  }

  const clienteToken = request.cookies?.[CLIENTE_COOKIE_NAME];
  if (clienteToken && request.server?.jwt) {
    try {
      const decoded = await request.server.jwt.verify(clienteToken);
      if (isClienteSessionPayload(decoded)) {
        const slug = (await tenantResolver.byId(decoded.cervejariaId)) ?? 'unknown';
        return {
          ...requestContext,
          cervejariaId: decoded.cervejariaId,
          slug,
          env,
          actor: {
            type: 'cliente',
            id: decoded.clienteId,
            clienteId: decoded.clienteId,
          },
        };
      }
    } catch {
      // ignore invalid cliente cookie
    }
  }

  const pdvSession = await readPdvClienteSession(request.server, request);
  if (pdvSession) {
    const slug = (await tenantResolver.byId(pdvSession.cervejariaId)) ?? 'unknown';
    return {
      ...requestContext,
      cervejariaId: pdvSession.cervejariaId,
      slug,
      env,
      actor: { type: 'cliente-pdv', id: pdvSession.clienteId, clienteId: pdvSession.clienteId },
    };
  }

  if (publicSlug) {
    const tenant = await tenantResolver.byPublicSlug(publicSlug);
    return {
      ...requestContext,
      cervejariaId: tenant?.id,
      slug: tenant?.slug ?? 'unknown',
      env,
      actor: { type: 'anonymous' },
    };
  }

  if (user?.papel === 'ADMIN') {
    return { ...requestContext, slug: 'system', env, actor: actorFromJwtUser(user) };
  }

  return {
    ...requestContext,
    slug: publicSlug ?? 'system',
    env,
    actor: user ? actorFromJwtUser(user) : { type: 'anonymous' },
  };
}

export function applyTelemetryContext(ctx: TelemetryContext): void {
  const span = trace.getActiveSpan();
  if (!span) return;

  const release = getReleaseContext();
  const dataset = logsIndexDataset(ctx.slug);
  span.setAttribute('releaseSha', release.releaseSha);
  span.setAttribute('service.name', release.service);
  span.setAttribute('deployment.environment.name', release.environment);
  if (ctx.requestId) span.setAttribute('request.id', ctx.requestId);
  if (ctx.correlationId) span.setAttribute('correlation.id', ctx.correlationId);
  if (ctx.interactionId) span.setAttribute('interaction.id', ctx.interactionId);
  span.setAttribute('cervejaria.id', ctx.cervejariaId ?? '');
  span.setAttribute('cervejaria.slug', ctx.slug);
  span.setAttribute('data_stream.dataset', dataset);
  span.setAttribute('data_stream.namespace', ctx.env);
  if (ctx.actor.id) span.setAttribute('actor.id', ctx.actor.id);
  if (ctx.actor.type) span.setAttribute('actor.type', ctx.actor.type);
  if (ctx.clientCountryCode) span.setAttribute('client.geo.country_iso_code', ctx.clientCountryCode);
}
