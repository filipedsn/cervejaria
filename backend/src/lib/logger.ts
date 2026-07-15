import pino from 'pino';

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
  });
}

export const logger = createLogger();
