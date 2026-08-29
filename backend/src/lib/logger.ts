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
  'OBS_ALERT_TELEGRAM_BOT_TOKEN',

];



let _logger: pino.Logger | undefined;



function buildPinoLogger(): pino.Logger {

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

        requestId: ctx.requestId,

        correlationId: ctx.correlationId,

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



/** Singleton Pino — Fastify e audit compartilham a mesma instância instrumentada pelo OTel. */

export function createLogger(): pino.Logger {

  if (!_logger) _logger = buildPinoLogger();

  return _logger;

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


