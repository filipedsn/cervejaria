import type { Server as SocketIOServer } from 'socket.io';
import { permissoesIndividuaisAtivas } from './operacao/permissoes.js';

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
  | { type: 'evento-caixa:updated'; data: { eventoId: string } }
  | { type: 'evento-caixa:financial-updated'; data: unknown }
  | { type: 'evento:deleted'; data: { id: string } }
  | { type: 'tap-montagem:updated'; data: { eventoId: string } }
  | { type: 'evento-cardapio:updated'; data: { eventoId: string } }
  | { type: 'pedido:created'; data: unknown }
  | { type: 'pedido:confirmed'; data: unknown }
  | { type: 'pedido:recusado'; data: unknown }
  | { type: 'pedido:cancelado'; data: unknown }
  | { type: 'operacao:pedido-novo'; data: unknown }
  | { type: 'operacao:pedido-atualizado'; data: unknown }
  | { type: 'operacao:comanda-atualizada'; data: { comandaId: string } }
  | { type: 'operacao:atendimento-pedido'; data: unknown }
  | { type: 'portal:session-expired'; data: { eventoId: string; reason: string } };

export const realtimeRoomTenant = (id: string) => `cervejaria:${id}`;
export const realtimeRoomTenantFinance = (id: string) => `cervejaria:${id}:financeiro`;
export const realtimeRoomTenantOperations = (id: string) => `cervejaria:${id}:operacao`;
export const realtimeRoomTenantCommands = (id: string) => `cervejaria:${id}:comandas`;
export const realtimeRoomTenantKitchen = (id: string) => `cervejaria:${id}:cozinha`;
export const realtimeRoomEvent = (id: string) => `evento:${id}`;
export const realtimeRoomEventFinance = (id: string) => `evento:${id}:financeiro`;
export const realtimeRoomEventOperations = (id: string) => `evento:${id}:operacao`;
export const realtimeRoomEventCommands = (id: string) => `evento:${id}:comandas`;
export const realtimeRoomEventKitchen = (id: string) => `evento:${id}:cozinha`;

function operationalPayload(event: RealtimeEvent): unknown {
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return {};
  const pick = (...keys: string[]) => Object.fromEntries(keys.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
  if (event.type.startsWith('operacao:pedido-')) {
    const pedido = (data.pedido && typeof data.pedido === 'object' ? data.pedido : data) as Record<string, unknown>;
    // resumoPedidoCozinha publishes `itens`; the UI contract remains
    // `itensComanda`, so project the real emitter shape into that contract.
    const items = Array.isArray(pedido.itens) ? pedido.itens
      : Array.isArray(pedido.itensComanda) ? pedido.itensComanda
        : [];
    return {
      id: pedido.id,
      numero: pedido.numero,
      status: pedido.status,
      diaOperacional: pedido.diaOperacional,
      paraViagem: pedido.paraViagem,
      observacao: pedido.observacao,
      comanda: pedido.comanda && typeof pedido.comanda === 'object'
        ? pickRecord(pedido.comanda as Record<string, unknown>, 'id', 'tipo', 'identificador', 'numero')
        : undefined,
      itensComanda: items.map((item) => {
        if (!item || typeof item !== 'object') return {};
        const record = item as Record<string, unknown>;
        return {
          ...pickRecord(record, 'id', 'nome', 'quantidade', 'volumeMl', 'observacao', 'exigePreparo', 'paraViagem', 'cancelamentoPendente', 'cancelamentoPendenteEm', 'canceladoEm'),
          ...(Array.isArray(record.opcionais) ? {
            opcionais: record.opcionais.map((optional) => optional && typeof optional === 'object'
              ? pickRecord(optional as Record<string, unknown>, 'id', 'nome', 'quantidade')
              : {}),
          } : {}),
        };
      }),
    };
  }
  if (event.type === 'evento-caixa:updated' || event.type === 'ranking:updated' || event.type === 'operacao:comanda-atualizada'
    || event.type === 'tap-montagem:updated' || event.type === 'evento-cardapio:updated' || event.type === 'evento:deleted') {
    return pick('id', 'eventoId', 'comandaId');
  }
  return pick('id', 'eventoId', 'comandaId', 'status', 'numero', 'tipo', 'identificador', 'pontoVendaId', 'ocorrenciaId');
}

function pickRecord(source: Record<string, unknown>, ...keys: string[]) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function invalidationPayload(event: RealtimeEvent): unknown {
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(['id', 'eventoId', 'comandaId'].filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
}

function emitScoped(
  io: SocketIOServer | undefined,
  legacyRoom: string,
  financeRoom: string,
  operationsRoom: string,
  commandsRoom: string,
  kitchenRoom: string,
  event: RealtimeEvent,
) {
  if (!io) return;
  if (!permissoesIndividuaisAtivas()) {
    io.to(legacyRoom).emit(event.type, event.data);
    return;
  }
  if (event.type === 'evento-caixa:financial-updated' || event.type === 'evento-caixa:updated') {
    io.to(financeRoom).emit(event.type, event.type === 'evento-caixa:updated' ? invalidationPayload(event) : event.data);
    return;
  }
  if (event.type === 'operacao:pedido-novo' || event.type === 'operacao:pedido-atualizado') {
    io.to(kitchenRoom).emit(event.type, operationalPayload(event));
    return;
  }
  if (event.type === 'operacao:atendimento-pedido') {
    io.to(commandsRoom).emit(event.type, event.data);
    return;
  }
  if (event.type.startsWith('comanda:') || event.type.startsWith('item:') || event.type.startsWith('pedido:') || event.type === 'operacao:comanda-atualizada') {
    io.to(commandsRoom).emit(event.type, event.type === 'operacao:comanda-atualizada' ? invalidationPayload(event) : event.data);
    return;
  }
  if (['ranking:updated', 'evento:updated', 'evento:deleted', 'tap-montagem:updated', 'evento-cardapio:updated'].includes(event.type)) {
    io.to(operationsRoom).emit(event.type, invalidationPayload(event));
  }
}

export function emitToCervejaria(
  io: SocketIOServer | undefined,
  cervejariaId: string,
  event: RealtimeEvent
): void {
  emitScoped(io, realtimeRoomTenant(cervejariaId), realtimeRoomTenantFinance(cervejariaId), realtimeRoomTenantOperations(cervejariaId), realtimeRoomTenantCommands(cervejariaId), realtimeRoomTenantKitchen(cervejariaId), event);
}

export function emitToEvento(
  io: SocketIOServer | undefined,
  eventoId: string,
  event: RealtimeEvent
): void {
  emitScoped(io, realtimeRoomEvent(eventoId), realtimeRoomEventFinance(eventoId), realtimeRoomEventOperations(eventoId), realtimeRoomEventCommands(eventoId), realtimeRoomEventKitchen(eventoId), event);
}

/** Financial-only event feed; restricted staff sockets never join this room. */
export function emitFinancialToEvento(io: SocketIOServer | undefined, eventoId: string, event: RealtimeEvent): void {
  io?.to(realtimeRoomEventFinance(eventoId)).emit(event.type, event.data);
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
