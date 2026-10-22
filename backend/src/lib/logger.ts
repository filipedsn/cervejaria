import pino from 'pino';

import { getTelemetryContext } from './telemetry-context.js';
import { getReleaseContext, type ReleaseContext } from './release-context.js';

const isProd = process.env.NODE_ENV === 'production';
const REDACTED = '[REDACTED]';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.x-api-key',
  'req.body',
  'authorization',
  'cookie',
  'token',
  'jwt',
  'password',
  'senha',
  'secret',
  'apiKey',
  'accessToken',
  'refreshToken',
  'connectionString',
  'databaseUrl',
];

const SENSITIVE_KEY = /authorization|cookie|jwt|token|password|senha|secret|api[-_]?key|connection[-_]?string|database[-_]?url|x-tap-geo-auth|email|telefone|address|endereco|requestBody|^payload$/i;
const SENSITIVE_VALUE = /\b(?:bearer|basic)\s+\S+|\b(?:eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)|\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqps?):\/\/\S+|https?:\/\/[^\s/@]+:[^\s/@]+@/i;

function redactString(value: string): string {
  return SENSITIVE_VALUE.test(value) ? REDACTED : value
    .replace(/([?&](?:token|key|password|email|secret|code)=)[^&#\s]*/gi, '$1[REDACTED]')
    .slice(0, 4000);
}

/** Redacts arbitrary structured Pino arguments before serialization or OTLP export. */
export function redactLogValue(value: unknown, key?: string, depth = 0): unknown {
  if (key && SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (depth > 8) return '[MAX_DEPTH]';
  if (value == null || typeof value !== 'object') return value;

  if (value instanceof Error) {
    const safe = new Error(redactString(value.message));
    safe.name = /^[A-Za-z0-9_.]{1,100}$/.test(value.name) ? value.name : 'Error';
    if (value.stack) safe.stack = redactString(value.stack);
    const code = (value as Error & { code?: unknown }).code;
    if (typeof code === 'string' && /^(?:P\d{4}|[A-Z0-9_]{2,40})$/.test(code)) {
      Object.assign(safe, { code });
    }
    return safe;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactLogValue(item, undefined, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    out[childKey] = redactLogValue(childValue, childKey, depth + 1);
  }
  return out;
}

function buildPinoLogger(destination?: pino.DestinationStream, release = getReleaseContext()): pino.Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
    // Pino's default base adds machine hostname and process PID to every record.
    // Release/service and request context below provide the required identifiers.
    base: null,
    formatters: { bindings: bindings => redactLogValue(bindings) as Record<string, unknown> },
    redact: { paths: redactPaths, censor: REDACTED },
    hooks: {
      logMethod(args, method) {
        method.apply(this, args.map((arg) => redactLogValue(arg)) as Parameters<typeof method>);
      },
    },
    mixin() {
      const ctx = getTelemetryContext();
      return {
        releaseSha: release.releaseSha,
        service: release.service,
        environment: release.environment,
        'data_stream.dataset': 'technical',
        'data_stream.namespace': ctx?.env ?? (isProd ? 'prd' : 'dev'),
        ...(ctx
          ? {
              requestId: ctx.requestId,
              correlationId: ctx.correlationId,
              cervejariaId: ctx.cervejariaId,
              cervejariaSlug: ctx.slug,
              observabilityEnv: ctx.env,
              userId: ctx.actor.id,
              role: ctx.actor.role,
              actorType: ctx.actor.type,
              actorId: ctx.actor.id,
            }
          : {}),
      };
    },
  }, destination);
}

let _logger: pino.Logger | undefined;

/** Singleton Pino — Fastify and audit share the instance instrumented by EDOT. */
export function createLogger(): pino.Logger {
  if (!_logger) _logger = buildPinoLogger();
  return _logger;
}

/** Test-only factory that leaves the production singleton and its stdout destination untouched. */
export function createLoggerForDestination(
  destination: pino.DestinationStream,
  release?: ReleaseContext,
): pino.Logger {
  return buildPinoLogger(destination, release);
}

export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_target, prop, receiver) {
    const real = createLogger() as unknown as Record<string | symbol, unknown>;
    const value = real[prop as keyof typeof real];
    if (typeof value === 'function') {
      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(createLogger(), args);
    }
    return Reflect.get(real, prop, receiver);
  },
});
