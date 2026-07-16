import pino from 'pino';
import { getTelemetryContext } from './telemetry-context.js';

const isProd = process.env.NODE_ENV === 'production';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.senha',
  'req.body.password',
  'req.body.token',
  'password',
  'senha',
  'senhaHash',
  'JWT_SECRET',
  'SMTP_PASS',
];

export function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
    redact: {
      paths: redactPaths,
      censor: '[REDACTED]',
    },
    mixin() {
      const ctx = getTelemetryContext();
      if (!ctx) return {};
      return {
        cervejariaId: ctx.cervejariaId,
        cervejariaSlug: ctx.slug,
        observabilityEnv: ctx.env,
        actorType: ctx.actor.type,
        actorId: ctx.actor.id,
        actorName: ctx.actor.name,
      };
    },
  });
}

export const logger = createLogger();
