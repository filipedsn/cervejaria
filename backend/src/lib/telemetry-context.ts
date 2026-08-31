import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyRequest } from 'fastify';
import { trace } from '@opentelemetry/api';
import type { JwtPayload } from '../types/auth.js';
import { isClienteSessionPayload, CLIENTE_COOKIE_NAME } from '../types/cliente-session.js';
import { getReleaseContext } from './release-context.js';

export type AuditActorType = 'usuario' | 'cliente' | 'system' | 'anonymous';

export type TelemetryActor = {
  type: AuditActorType;
  id?: string;
  role?: string;
  name?: string;
  email?: string;
  clienteId?: string;
};

export type TelemetryContext = {
  /** Fastify's per-request ID, separate from the logical correlation ID. */
  requestId?: string;
  correlationId?: string;
  cervejariaId?: string;
  slug: string;
  env: 'dev' | 'prd';
  actor: TelemetryActor;
};

const storage = new AsyncLocalStorage<TelemetryContext>();

const slugCache = new Map<string, { slug: string; expiresAt: number }>();
const SLUG_CACHE_TTL_MS = 5 * 60 * 1000;

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

export function auditIndexName(slug: string, env: 'dev' | 'prd' = getObservabilityEnv()): string {
  return `audit-${sanitizeSlugForIndex(slug)}.otel-${env}`;
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
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function actorFromJwtUser(user: JwtPayload): TelemetryActor {
  return {
    type: user.papel === 'ADMIN' ? 'system' : 'usuario',
    id: user.sub,
    role: user.papel,
    name: user.nome,
    email: user.email,
  };
}

export async function resolveTelemetryFromRequest(request: FastifyRequest): Promise<TelemetryContext> {
  const env = getObservabilityEnv();
  const publicSlug = slugFromPublicPath(request.url);
  const requestContext = { requestId: request.id, correlationId: request.correlationId };

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
    const slug = (await resolveSlugByCervejariaId(user.cervejariaId)) ?? 'unknown';
    return {
      ...requestContext,
      cervejariaId: user.cervejariaId,
      slug,
      env,
      actor: actorFromJwtUser(user),
    };
  }

  if (publicSlug) {
    return {
      ...requestContext,
      slug: publicSlug,
      env,
      actor: { type: 'anonymous' },
    };
  }

  const clienteToken = request.cookies?.[CLIENTE_COOKIE_NAME];
  if (clienteToken && request.server?.jwt) {
    try {
      const decoded = await request.server.jwt.verify(clienteToken);
      if (isClienteSessionPayload(decoded)) {
        const slug =
          (await resolveSlugByCervejariaId(decoded.cervejariaId)) ?? publicSlug ?? 'unknown';
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
  span.setAttribute('cervejaria.id', ctx.cervejariaId ?? '');
  span.setAttribute('cervejaria.slug', ctx.slug);
  span.setAttribute('data_stream.dataset', dataset);
  span.setAttribute('data_stream.namespace', ctx.env);
  if (ctx.actor.id) span.setAttribute('actor.id', ctx.actor.id);
  if (ctx.actor.type) span.setAttribute('actor.type', ctx.actor.type);
}
