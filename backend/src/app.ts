import Fastify, { type FastifyBaseLogger } from 'fastify';

import { ZodError } from 'zod';
import { trace, SpanStatusCode } from '@opentelemetry/api';

import cors from '@fastify/cors';

import cookie from '@fastify/cookie';

import jwt from '@fastify/jwt';

import sensible from '@fastify/sensible';

import helmet from '@fastify/helmet';

import multipart from '@fastify/multipart';

import fastifyStatic from '@fastify/static';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

import { fileURLToPath } from 'url';

import fs from 'fs';

import { authRoutes } from './routes/auth.js';

import { usuariosRoutes } from './routes/usuarios.js';

import { produtosRoutes } from './routes/produtos.js';

import { tapsRoutes } from './routes/taps.js';

import { trailersRoutes } from './routes/trailers.js';

import { cardapiosRoutes } from './routes/cardapios.js';

import { eventosRoutes } from './routes/eventos.js';

import { clientesRoutes } from './routes/clientes.js';

import { comandasRoutes } from './routes/comandas.js';

import { pagamentosRoutes } from './routes/pagamentos.js';
import { vendasAvulsasRoutes } from './routes/vendas-avulsas.js';

import { rankingRoutes } from './routes/ranking.js';

import { relatoriosRoutes } from './routes/relatorios.js';

import { adminRoutes } from './routes/admin.js';

import { cervejariaRoutes } from './routes/cervejaria.js';

import { publicRoutes } from './routes/public.js';
import { pedidosRoutes } from './routes/pedidos.js';
import { operacaoRoutes } from './routes/operacao/index.js';
import { registerClienteSessionAuth } from './lib/cliente-session.js';

import { ensureUploadsDir, getUploadsRoot } from './lib/uploads.js';

import { verifySession } from './lib/session.js';

import { setupSocketAuth } from './lib/socket-auth.js';

import {

  AUTH_COOKIE_NAME,

  getCorsOrigin,
  getSocketCorsOrigin,

  getJwtExpiresIn,

  getJwtSecret,

} from './lib/security-config.js';

import { getReadinessStatus } from './lib/health.js';
import { createLogger } from './lib/logger.js';
import { logUnhandledRequestError } from './lib/technical-log.js';
import { registerAuditHooks } from './lib/audit-hooks.js';
import { registerCorrelationContext } from './lib/correlation-context.js';
import { emitAuthEvent, sessionReasonCode } from './lib/auth-observability.js';
import { auditRoutes } from './routes/audit.js';
import { pushRoutes } from './routes/push.js';
import { observabilityRoutes } from './routes/observability.js';
import { onboardingRoutes } from './routes/onboarding.js';

import type { JwtPayload } from './types/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hasErrorProperty<Key extends string>(
  value: unknown,
  key: Key,
): value is Record<Key, unknown> {
  return typeof value === 'object' && value !== null && key in value;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return hasErrorProperty(error, 'message') && typeof error.message === 'string'
    ? error.message
    : undefined;
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (!hasErrorProperty(error, 'statusCode') || typeof error.statusCode !== 'number') {
    return undefined;
  }

  return Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode
    : undefined;
}

function resolveFrontendDist(): string | null {
  const envDist = process.env.FRONTEND_DIST?.trim();
  if (envDist) {
    const resolved = path.isAbsolute(envDist) ? envDist : path.resolve(__dirname, envDist);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  const legacyDist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(legacyDist)) {
    if (process.env.NODE_ENV === 'production' && !envDist) {
      console.warn(
        '[quiver-tap] FRONTEND_DIST nao definido; servindo frontend/dist legado. Publique via prod:deploy.',
      );
    }
    return legacyDist;
  }

  return null;
}

export async function buildApp() {
  const app = Fastify<HttpServer, IncomingMessage, ServerResponse<IncomingMessage>, FastifyBaseLogger>({
    loggerInstance: createLogger(),
  });

  await app.register(helmet, {

    contentSecurityPolicy: false,

    crossOriginResourcePolicy: { policy: 'cross-origin' },

  });



  await app.register(cors, {

    origin: getCorsOrigin(),

    credentials: true,

  });



  await app.register(cookie);



  await app.register(sensible);



  await app.register(jwt, {

    secret: getJwtSecret(),

    sign: {

      expiresIn: getJwtExpiresIn(),

    },

    cookie: {

      cookieName: AUTH_COOKIE_NAME,

      signed: false,

    },

  });



  await app.register(multipart, {

    limits: { fileSize: 5 * 1024 * 1024 },

  });



  app.decorate('authenticate', async (request) => {

    await verifySession(app, request);

  });



  // Rotas de tenant assumem `cervejariaId` presente; o token de plataforma (ADMIN)
  // nao tem um, e sem essa barreira a consulta explode em 500 em vez de 403.
  app.decorate('requireTenant', async (request) => {

    await verifySession(app, request);

    const user = request.user as JwtPayload;

    if (!user.cervejariaId) {

      emitAuthEvent(request, 'auth.authorization.denied', {
        reasonCode: 'TENANT_MISMATCH',
        user,
      });

      throw app.httpErrors.forbidden('Rota exclusiva de cervejaria');

    }

  });



  app.decorate('requireDono', async (request) => {

    if (!request.user) await verifySession(app, request);

    const user = request.user as JwtPayload;

    if (user.papel !== 'DONO') {

      emitAuthEvent(request, 'auth.authorization.denied', { reasonCode: 'ROLE_DENIED', user });

      throw app.httpErrors.forbidden('Acesso restrito ao proprietário');

    }

  });



  app.decorate('requireAdmin', async (request) => {

    if (!request.user) await verifySession(app, request);

    const user = request.user as JwtPayload;

    if (user.papel !== 'ADMIN') {

      emitAuthEvent(request, 'auth.authorization.denied', { reasonCode: 'ROLE_DENIED', user });

      throw app.httpErrors.forbidden('Acesso restrito ao administrador');

    }

  });

  registerClienteSessionAuth(app);

  registerCorrelationContext(app);
  registerAuditHooks(app);



  app.setErrorHandler((error, request, reply) => {

    const validation = hasErrorProperty(error, 'validation') ? error.validation : undefined;
    const code = hasErrorProperty(error, 'code') && typeof error.code === 'string' ? error.code : '';
    const message = getErrorMessage(error);
    const statusCode = getErrorStatusCode(error);

    if (statusCode === 401 && !request.url.startsWith('/api/auth/login')) {
      emitAuthEvent(request, 'auth.session.rejected', { reasonCode: sessionReasonCode(error) });
    }

    if (error instanceof ZodError) {

      const message = error.errors[0]?.message ?? 'Dados inválidos';

      return reply.status(400).send({ error: message });

    }

    if (validation) {

      return reply.status(400).send({ error: 'Dados inválidos', details: validation });

    }

    if (code.startsWith('FST_JWT_') || code === 'FAST_JWT_MISSING_SIGNATURE') {
      return reply.status(401).send({ error: message || 'Não autorizado' });
    }

    if (statusCode) {

      return reply.status(statusCode).send({ error: message });

    }

    const span = trace.getActiveSpan();
    if (span) {
      const exception = error instanceof Error
        ? error
        : { name: 'Error', message: message ?? 'Erro interno do servidor' };
      span.recordException(exception);
      span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message });
    }

    logUnhandledRequestError(app.log, request, reply, error);

    return reply.status(500).send({ error: 'Erro interno do servidor' });

  });



  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  app.get('/api/ready', async (_request, reply) => {
    const readiness = await getReadinessStatus();
    if (readiness.status !== 'ready') {
      return reply.status(503).send(readiness);
    }
    return readiness;
  });

  await app.register(authRoutes, { prefix: '/api/auth' });

  await app.register(auditRoutes, { prefix: '/api/audit' });

  await app.register(observabilityRoutes, { prefix: '/api/observability' });

  await app.register(onboardingRoutes, { prefix: '/api/onboarding' });

  await app.register(usuariosRoutes, { prefix: '/api/usuarios' });

  await app.register(produtosRoutes, { prefix: '/api/produtos' });

  await app.register(tapsRoutes, { prefix: '/api/taps' });

  await app.register(trailersRoutes, { prefix: '/api/trailers' });

  await app.register(cardapiosRoutes, { prefix: '/api/cardapios' });

  await app.register(eventosRoutes, { prefix: '/api/eventos' });

  await app.register(clientesRoutes, { prefix: '/api/clientes' });

  await app.register(comandasRoutes, { prefix: '/api/comandas' });

  await app.register(pagamentosRoutes, { prefix: '/api/pagamentos' });

  await app.register(vendasAvulsasRoutes, { prefix: '/api/vendas-avulsas' });

  await app.register(rankingRoutes, { prefix: '/api/ranking' });

  await app.register(relatoriosRoutes, { prefix: '/api/relatorios' });

  await app.register(adminRoutes, { prefix: '/api/admin' });

  await app.register(cervejariaRoutes, { prefix: '/api/cervejaria' });

  await app.register(publicRoutes, { prefix: '/api/public' });

  await app.register(pedidosRoutes, { prefix: '/api/pedidos' });

  await app.register(pushRoutes, { prefix: '/api/push' });

  await app.register(operacaoRoutes, { prefix: '/api/operacao' });



  ensureUploadsDir();

  await app.register(fastifyStatic, {

    root: getUploadsRoot(),

    prefix: '/uploads/',

    decorateReply: false,

    setHeaders(res, filePath) {
      if (
        filePath.includes(`${path.sep}logos${path.sep}`) ||
        filePath.includes(`${path.sep}portal-backgrounds${path.sep}`)
      ) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
    },

  });



  const frontendDist = resolveFrontendDist();

  if (frontendDist) {

    await app.register(fastifyStatic, {

      root: frontendDist,

      prefix: '/',

    });



    app.setNotFoundHandler((request, reply) => {

      if (request.url.startsWith('/api/')) {

        return reply.status(404).send({ error: 'Rota não encontrada' });

      }

      // Resquício do Vite dev (porta 5201): evitar fallback HTML que quebra service workers antigos.
      if (/\/dev-sw\.js|\/@vite\/|\/@react-refresh|\/node_modules\//.test(request.url)) {
        return reply.status(404).send({ error: 'Not found' });
      }

      return reply.sendFile('index.html');

    });

  } else {

    app.log.info('Frontend dist não encontrado - servindo apenas API');

  }



  return app;

}



export function setupSocketIO(app: Awaited<ReturnType<typeof buildApp>>, server: import('http').Server) {
  const io = new SocketIOServer(server, {

    cors: {

      origin: getSocketCorsOrigin(),

      credentials: true,

    },

  });



  setupSocketAuth(io, app);

  app.decorate('io', io);

  return io;

}


