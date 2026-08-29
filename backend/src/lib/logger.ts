import pino from 'pino';

import { getTelemetryContext } from './telemetry-context.js';

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

const SENSITIVE_KEY = /authorization|cookie|jwt|token|password|senha|secret|api[-_]?key|connection[-_]?string|database[-_]?url/i;
const SENSITIVE_VALUE = /\b(?:bearer|basic)\s+\S+|\b(?:eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)|\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqps?):\/\/\S+|https?:\/\/[^\s/@]+:[^\s/@]+@/i;

function redactString(value: string): string {
  return SENSITIVE_VALUE.test(value) ? REDACTED : value;
}

/** Redacts arbitrary structured Pino arguments before serialization or OTLP export. */
export function redactLogValue(value: unknown, key?: string, depth = 0): unknown {
  if (key && SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (value == null || typeof value !== 'object' || depth > 8) return value;

  if (value instanceof Error) {
    const safe = new Error(redactString(value.message));
    safe.name = value.name;
    if (value.stack) safe.stack = redactString(value.stack);
    return safe;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactLogValue(item, undefined, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = redactLogValue(childValue, childKey, depth + 1);
  }
  return out;
}

function buildPinoLogger(destination?: pino.DestinationStream): pino.Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
    redact: { paths: redactPaths, censor: REDACTED },
    hooks: {
      logMethod(args, method) {
        method.apply(this, args.map((arg) => redactLogValue(arg)) as Parameters<typeof method>);
      },
    },
    mixin() {
      const ctx = getTelemetryContext();
      return {
        service: process.env.OTEL_SERVICE_NAME ?? 'quiver-tap-api',
        environment: process.env.NODE_ENV ?? 'development',
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
export function createLoggerForDestination(destination: pino.DestinationStream): pino.Logger {
  return buildPinoLogger(destination);
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
