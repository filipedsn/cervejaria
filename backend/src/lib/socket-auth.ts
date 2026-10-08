import { parseCookie } from 'cookie';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { prisma } from './prisma.js';
import { AUTH_COOKIE_NAME } from './security-config.js';
import { verifyJwtPayload } from './session.js';
import type { JwtPayload } from '../types/auth.js';
import {
  CLIENTE_COOKIE_NAME,
  isClienteSessionPayload,
  type ClienteSessionPayload,
} from '../types/cliente-session.js';
import {
  ClienteSessionValidationError,
  validateClienteSession,
} from './cliente-session.js';
import { validCorrelationId } from './correlation-context.js';
import { permissoesIndividuaisAtivas, usuarioPode } from './operacao/permissoes.js';
import {
  realtimeRoomEvent, realtimeRoomEventFinance, realtimeRoomEventOperations, realtimeRoomEventCommands, realtimeRoomEventKitchen,
  realtimeRoomTenant, realtimeRoomTenantFinance, realtimeRoomTenantOperations, realtimeRoomTenantCommands, realtimeRoomTenantKitchen,
} from './realtime.js';

type StaffRealtimeSocket = Socket & { data: { user?: JwtPayload; authType?: string; eventoSubscriptions?: Set<string>; tenantSubscriptions?: Set<string> } };

async function joinScopedStaffRoom(socket: StaffRealtimeSocket, kind: 'evento' | 'cervejaria', id: string, user: JwtPayload) {
  const permissionsEnabled = permissoesIndividuaisAtivas();
  const rooms = kind === 'evento'
    ? { legacy: realtimeRoomEvent(id), finance: realtimeRoomEventFinance(id), invalidations: realtimeRoomEventOperations(id), commands: realtimeRoomEventCommands(id), kitchen: realtimeRoomEventKitchen(id) }
    : { legacy: realtimeRoomTenant(id), finance: realtimeRoomTenantFinance(id), invalidations: realtimeRoomTenantOperations(id), commands: realtimeRoomTenantCommands(id), kitchen: realtimeRoomTenantKitchen(id) };
  if (!permissionsEnabled) {
    await socket.join(rooms.legacy);
  } else {
    await socket.join(rooms.invalidations);
    if (await usuarioPode(user, 'cash.values.read')) await socket.join(rooms.finance);
    if (await usuarioPode(user, 'command.read')) await socket.join(rooms.commands);
    if (await usuarioPode(user, 'kitchen.read')) await socket.join(rooms.kitchen);
  }
  const subscriptions = kind === 'evento' ? socket.data.eventoSubscriptions : socket.data.tenantSubscriptions;
  if (subscriptions) subscriptions.add(id);
}

/** Move already connected staff sockets when the owner's permission list changes. */
export async function reconcileRealtimePermissionsForUser(app: FastifyInstance, userId: string, cervejariaId: string) {
  if (!permissoesIndividuaisAtivas()) return;
  if (!app.io?.sockets) return;
  const sockets = [...app.io.sockets.sockets.values()] as StaffRealtimeSocket[];
  for (const socket of sockets) {
    const user = socket.data.user;
    if (socket.data.authType !== 'staff' || !user || user.sub !== userId) continue;
    const permissions = {
      finance: await usuarioPode(user, 'cash.values.read'),
      commands: await usuarioPode(user, 'command.read'),
      kitchen: await usuarioPode(user, 'kitchen.read'),
    };
    const roomsFor = (kind: 'evento' | 'cervejaria', id: string) => kind === 'evento'
      ? { legacy: realtimeRoomEvent(id), finance: realtimeRoomEventFinance(id), invalidations: realtimeRoomEventOperations(id), commands: realtimeRoomEventCommands(id), kitchen: realtimeRoomEventKitchen(id) }
      : { legacy: realtimeRoomTenant(id), finance: realtimeRoomTenantFinance(id), invalidations: realtimeRoomTenantOperations(id), commands: realtimeRoomTenantCommands(id), kitchen: realtimeRoomTenantKitchen(id) };
    for (const eventId of socket.data.eventoSubscriptions ?? []) {
      const rooms = roomsFor('evento', eventId);
      for (const room of [rooms.finance, rooms.invalidations, rooms.commands, rooms.kitchen]) await socket.leave(room);
      if (user.cervejariaId === cervejariaId) {
        await socket.join(rooms.invalidations);
        if (permissions.finance) await socket.join(rooms.finance);
        if (permissions.commands) await socket.join(rooms.commands);
        if (permissions.kitchen) await socket.join(rooms.kitchen);
      }
    }
    for (const tenantId of socket.data.tenantSubscriptions ?? []) {
      const rooms = roomsFor('cervejaria', tenantId);
      for (const room of [rooms.finance, rooms.invalidations, rooms.commands, rooms.kitchen]) await socket.leave(room);
      if (tenantId === cervejariaId && user.cervejariaId === cervejariaId) {
        await socket.join(rooms.invalidations);
        if (permissions.finance) await socket.join(rooms.finance);
        if (permissions.commands) await socket.join(rooms.commands);
        if (permissions.kitchen) await socket.join(rooms.kitchen);
      }
    }
  }
}

function extractStaffToken(socket: Socket): string | null {
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

function extractClienteToken(socket: Socket): string | null {
  const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
  return cookies[CLIENTE_COOKIE_NAME] ?? null;
}

function correlationId(socket: Socket): string | undefined {
  const value = socket.handshake.headers['x-correlation-id'];
  const candidate = Array.isArray(value) ? value[0] : value;
  return validCorrelationId(candidate) ? candidate : undefined;
}

export function realtimeEvent(
  app: FastifyInstance,
  socket: Socket,
  action: 'realtime.session.accepted' | 'realtime.session.rejected' | 'realtime.room.joined' | 'realtime.room.denied',
  fields: Record<string, unknown>,
) {
  const payload = { event: action, socketId: socket.id, correlationId: correlationId(socket), ...fields };
  try {
    if (action.endsWith('rejected') || action.endsWith('denied')) app.log.warn(payload, action);
    else app.log.info(payload, action);
  } catch {
    // Observability must not affect Socket.IO authorization or delivery.
  }
}

function logSocketAuthDenied(
  app: FastifyInstance,
  socket: Socket,
  authType: 'cliente' | 'staff',
  reason: string,
  session?: ClienteSessionPayload,
) {
  realtimeEvent(app, socket, 'realtime.session.rejected', {
    actorType: authType === 'cliente' ? 'portal' : 'staff',
    reasonCode: authType === 'cliente' ? 'PORTAL_SESSION_INVALID' : 'SESSION_INVALID',
    ...(session ? {
      cervejariaId: session.cervejariaId,
      eventoId: session.eventoId,
      comandaId: session.comandaId,
    } : {}),
  });
}

export function setupSocketAuth(io: SocketIOServer, app: FastifyInstance) {
  io.use(async (socket, next) => {
    try {
      const clienteToken = extractClienteToken(socket);
      if (clienteToken) {
        let decoded: unknown;
        try {
          decoded = app.jwt.verify(clienteToken);
        } catch {
          logSocketAuthDenied(app, socket, 'cliente', 'token_invalido');
          return next(new Error('Unauthorized'));
        }

        if (!isClienteSessionPayload(decoded)) {
          logSocketAuthDenied(app, socket, 'cliente', 'payload_invalido');
          return next(new Error('Unauthorized'));
        }

        try {
          const session = await validateClienteSession(decoded);
          socket.data.authType = 'cliente';
          socket.data.clienteSession = session;
          realtimeEvent(app, socket, 'realtime.session.accepted', {
            actorType: 'portal', cervejariaId: session.cervejariaId, eventoId: session.eventoId, comandaId: session.comandaId,
          });
          return next();
        } catch (error) {
          const reason = error instanceof ClienteSessionValidationError
            ? error.reason
            : 'validacao_indisponivel';
          logSocketAuthDenied(app, socket, 'cliente', reason, decoded);
          return next(new Error('Unauthorized'));
        }
      }

      const raw = extractStaffToken(socket);
      if (!raw) {
        logSocketAuthDenied(app, socket, 'staff', 'token_ausente');
        return next(new Error('Unauthorized'));
      }
      const decoded = app.jwt.verify<JwtPayload>(raw);
      const user = await verifyJwtPayload(app, decoded);
      socket.data.authType = 'staff';
      socket.data.user = user;
      realtimeEvent(app, socket, 'realtime.session.accepted', {
        actorType: 'staff', userId: user.sub, role: user.papel, cervejariaId: user.cervejariaId,
      });
      next();
    } catch {
      logSocketAuthDenied(app, socket, 'staff', 'token_invalido');
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.data.authType === 'cliente') {
      const session = socket.data.clienteSession as ClienteSessionPayload;
      socket.join(`portal:evento:${session.eventoId}`);
      socket.join(`comanda:${session.comandaId}`);
      realtimeEvent(app, socket, 'realtime.room.joined', { actorType: 'portal', roomType: 'portal_evento', entityId: session.eventoId, cervejariaId: session.cervejariaId });
      realtimeEvent(app, socket, 'realtime.room.joined', { actorType: 'portal', roomType: 'comanda', entityId: session.comandaId, cervejariaId: session.cervejariaId });
      socket.on('join:cervejaria', () => realtimeEvent(app, socket, 'realtime.room.denied', { actorType: 'portal', reasonCode: 'ROLE_DENIED', roomType: 'cervejaria' }));
      socket.on('join:evento', () => realtimeEvent(app, socket, 'realtime.room.denied', { actorType: 'portal', reasonCode: 'ROLE_DENIED', roomType: 'evento' }));
      return;
    }

    const staffSocket = socket as StaffRealtimeSocket;
    const user = socket.data.user as JwtPayload;
    staffSocket.data.eventoSubscriptions = new Set();
    staffSocket.data.tenantSubscriptions = new Set();

    socket.on('join:cervejaria', async (cervejariaId: string) => {
      if (!cervejariaId || typeof cervejariaId !== 'string') {
        realtimeEvent(app, socket, 'realtime.room.denied', { actorType: 'staff', reasonCode: 'SESSION_INVALID', roomType: 'cervejaria' });
        return;
      }
      if (user.papel !== 'ADMIN' && user.cervejariaId !== cervejariaId) {
        realtimeEvent(app, socket, 'realtime.room.denied', { actorType: 'staff', userId: user.sub, role: user.papel, reasonCode: 'TENANT_MISMATCH', roomType: 'cervejaria', entityId: cervejariaId });
        return;
      }
      if (user.papel === 'ADMIN') {
        if (!permissoesIndividuaisAtivas()) await socket.join(realtimeRoomTenant(cervejariaId));
        else await Promise.all([
          socket.join(realtimeRoomTenantFinance(cervejariaId)),
          socket.join(realtimeRoomTenantOperations(cervejariaId)),
          socket.join(realtimeRoomTenantCommands(cervejariaId)),
          socket.join(realtimeRoomTenantKitchen(cervejariaId)),
        ]);
        staffSocket.data.tenantSubscriptions?.add(cervejariaId);
        realtimeEvent(app, socket, 'realtime.room.joined', { actorType: 'staff', userId: user.sub, role: user.papel, roomType: 'cervejaria', entityId: cervejariaId });
        return;
      }
      const tenant = await prisma.cervejaria.findUnique({ where: { id: cervejariaId }, select: { id: true } });
      if (!tenant || !(await prisma.usuario.findFirst({ where: { id: user.sub, cervejariaId }, select: { id: true } }))) {
        realtimeEvent(app, socket, 'realtime.room.denied', { actorType: 'staff', userId: user.sub, reasonCode: 'TENANT_MISMATCH', roomType: 'cervejaria', entityId: cervejariaId });
        return;
      }
      await joinScopedStaffRoom(staffSocket, 'cervejaria', cervejariaId, user);
      realtimeEvent(app, socket, 'realtime.room.joined', { actorType: 'staff', userId: user.sub, role: user.papel, roomType: 'cervejaria', entityId: cervejariaId });
    });

    socket.on('join:evento', async (eventoId: string) => {
      if (!eventoId || typeof eventoId !== 'string') {
        realtimeEvent(app, socket, 'realtime.room.denied', { actorType: 'staff', reasonCode: 'SESSION_INVALID', roomType: 'evento' });
        return;
      }
      if (user.papel === 'ADMIN') return;

      const evento = await prisma.evento.findFirst({
        where: { id: eventoId, cervejariaId: user.cervejariaId ?? undefined },
        select: { id: true },
      });
      if (!evento) {
        realtimeEvent(app, socket, 'realtime.room.denied', { actorType: 'staff', userId: user.sub, role: user.papel, reasonCode: 'TENANT_MISMATCH', roomType: 'evento', entityId: eventoId });
        return;
      }
      await joinScopedStaffRoom(staffSocket, 'evento', eventoId, user);
      realtimeEvent(app, socket, 'realtime.room.joined', { actorType: 'staff', userId: user.sub, role: user.papel, roomType: 'evento', entityId: eventoId });
    });

    socket.on('leave:evento', (eventoId: string) => {
      if (eventoId) {
        if (permissoesIndividuaisAtivas()) {
          socket.leave(realtimeRoomEventFinance(eventoId));
          socket.leave(realtimeRoomEventOperations(eventoId));
          socket.leave(realtimeRoomEventCommands(eventoId));
          socket.leave(realtimeRoomEventKitchen(eventoId));
        } else {
          socket.leave(realtimeRoomEvent(eventoId));
        }
        staffSocket.data.eventoSubscriptions?.delete(eventoId);
      }
    });
  });
}
