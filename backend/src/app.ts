import Fastify from 'fastify';

import { ZodError } from 'zod';

import cors from '@fastify/cors';

import cookie from '@fastify/cookie';

import jwt from '@fastify/jwt';

import sensible from '@fastify/sensible';

import helmet from '@fastify/helmet';

import multipart from '@fastify/multipart';

import fastifyStatic from '@fastify/static';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';

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
import { registerClienteSessionAuth } from './lib/cliente-session.js';

import { ensureUploadsDir, getUploadsRoot } from './lib/uploads.js';

import { verifySession } from './lib/session.js';

import { setupSocketAuth } from './lib/socket-auth.js';

import {

  AUTH_COOKIE_NAME,

  getCorsOrigin,

  getJwtExpiresIn,

  getJwtSecret,

} from './lib/security-config.js';

import { getReadinessStatus } from './lib/health.js';
import { createLogger } from './lib/logger.js';
import { registerAuditHooks } from './lib/audit-hooks.js';
import { auditRoutes } from './routes/audit.js';
import { pushRoutes } from './routes/push.js';

import type { JwtPayload } from './types/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  const app = Fastify({ loggerInstance: createLogger() });

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



  app.decorate('requireDono', async (request) => {

    if (!request.user) await verifySession(app, request);

    const user = request.user as JwtPayload;

    if (user.papel !== 'DONO') {

      throw app.httpErrors.forbidden('Acesso restrito ao proprietário');

    }

  });



  app.decorate('requireAdmin', async (request) => {

    if (!request.user) await verifySession(app, request);

    const user = request.user as JwtPayload;

    if (user.papel !== 'ADMIN') {

      throw app.httpErrors.forbidden('Acesso restrito ao administrador');

    }

  });

  registerClienteSessionAuth(app);

  registerAuditHooks(app);



  app.setErrorHandler((error, _request, reply) => {

    if (error instanceof ZodError) {

      const message = error.errors[0]?.message ?? 'Dados inválidos';

      return reply.status(400).send({ error: message });

    }

    if (error.validation) {

      return reply.status(400).send({ error: 'Dados inválidos', details: error.validation });

    }

    const code = (error as { code?: string }).code ?? '';
    if (code.startsWith('FST_JWT_') || code === 'FAST_JWT_MISSING_SIGNATURE') {
      return reply.status(401).send({ error: error.message || 'Não autorizado' });
    }

    if (error.statusCode) {

      return reply.status(error.statusCode).send({ error: error.message });

    }

    app.log.error(error);

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



  ensureUploadsDir();

  await app.register(fastifyStatic, {

    root: getUploadsRoot(),

    prefix: '/uploads/',

    decorateReply: false,

    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}logos${path.sep}`)) {
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

      origin: getCorsOrigin(),

      credentials: true,

    },

  });



  setupSocketAuth(io, app);

  app.decorate('io', io);

  return io;

}


