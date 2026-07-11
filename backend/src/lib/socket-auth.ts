import { parseCookie } from 'cookie';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { prisma } from './prisma.js';
import { AUTH_COOKIE_NAME } from './security-config.js';
import { verifyJwtPayload } from './session.js';
import type { JwtPayload } from '../types/auth.js';

function extractSocketToken(socket: Socket): string | null {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
  const fromCookie = cookies[AUTH_COOKIE_NAME];
  if (fromCookie) return fromCookie;

  const authHeader = socket.handshake.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

export function setupSocketAuth(io: SocketIOServer, app: FastifyInstance) {
  io.use(async (socket, next) => {
    try {
      const raw = extractSocketToken(socket);
      if (!raw) {
        return next(new Error('Unauthorized'));
      }
      const decoded = app.jwt.verify<JwtPayload>(raw);
      const user = await verifyJwtPayload(app, decoded);
      socket.data.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as JwtPayload;

    socket.on('join:cervejaria', (cervejariaId: string) => {
      if (!cervejariaId || typeof cervejariaId !== 'string') return;
      if (user.papel !== 'ADMIN' && user.cervejariaId !== cervejariaId) return;
      socket.join(`cervejaria:${cervejariaId}`);
    });

    socket.on('join:evento', async (eventoId: string) => {
      if (!eventoId || typeof eventoId !== 'string') return;
      if (user.papel === 'ADMIN') return;

      const evento = await prisma.evento.findFirst({
        where: { id: eventoId, cervejariaId: user.cervejariaId ?? undefined },
        select: { id: true },
      });
      if (!evento) return;
      socket.join(`evento:${eventoId}`);
    });

    socket.on('leave:evento', (eventoId: string) => {
      if (eventoId) socket.leave(`evento:${eventoId}`);
    });
  });
}
