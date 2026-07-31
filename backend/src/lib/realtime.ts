import type { Server as SocketIOServer } from 'socket.io';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

export type RealtimeEvent =
  | { type: 'comanda:created'; data: unknown }
  | { type: 'comanda:updated'; data: unknown }
  | { type: 'comanda:closed'; data: unknown }
  | { type: 'item:added'; data: unknown }
  | { type: 'item:removed'; data: unknown }
  | { type: 'ranking:updated'; data: unknown }
  | { type: 'evento:updated'; data: unknown }
  | { type: 'evento:deleted'; data: { id: string } }
  | { type: 'pedido:created'; data: unknown }
  | { type: 'pedido:confirmed'; data: unknown }
  | { type: 'pedido:recusado'; data: unknown }
  | { type: 'pedido:cancelado'; data: unknown }
  | { type: 'quiosque:pedido-novo'; data: unknown }
  | { type: 'quiosque:pedido-atualizado'; data: unknown }
  | { type: 'portal:session-expired'; data: { eventoId: string; reason: string } };

export function emitToCervejaria(
  io: SocketIOServer | undefined,
  cervejariaId: string,
  event: RealtimeEvent
): void {
  io?.to(`cervejaria:${cervejariaId}`).emit(event.type, event.data);
}

export function emitToEvento(
  io: SocketIOServer | undefined,
  eventoId: string,
  event: RealtimeEvent
): void {
  io?.to(`evento:${eventoId}`).emit(event.type, event.data);
}

export function emitToComanda(
  io: SocketIOServer | undefined,
  comandaId: string,
  event: RealtimeEvent
): void {
  io?.to(`comanda:${comandaId}`).emit(event.type, event.data);
}

/** Notifica telas de ranking após venda, remoção ou ajuste de chope no evento. */
export function emitRankingUpdated(
  io: SocketIOServer | undefined,
  cervejariaId: string,
  eventoId: string
): void {
  const payload = { eventoId };
  emitToEvento(io, eventoId, { type: 'ranking:updated', data: payload });
  emitToCervejaria(io, cervejariaId, { type: 'ranking:updated', data: payload });
}
