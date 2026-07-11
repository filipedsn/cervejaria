import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
const joinedEventoIds = new Set<string>();
let joinedCervejariaId: string | null = null;

function rejoinRooms(s: Socket): void {
  if (joinedCervejariaId) {
    s.emit('join:cervejaria', joinedCervejariaId);
  }
  for (const eventoId of joinedEventoIds) {
    s.emit('join:evento', eventoId);
  }
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(import.meta.env.VITE_SOCKET_URL ?? '', {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socket.on('connect', () => rejoinRooms(socket!));
  }
  return socket;
}

export function connectSocket(cervejariaId: string): Socket {
  const s = getSocket();
  joinedCervejariaId = cervejariaId;
  if (!s.connected) s.connect();
  else rejoinRooms(s);
  return s;
}

export function joinEvento(eventoId: string): void {
  joinedEventoIds.add(eventoId);
  const s = getSocket();
  if (s.connected) s.emit('join:evento', eventoId);
}

export function leaveEvento(eventoId: string): void {
  joinedEventoIds.delete(eventoId);
  getSocket().emit('leave:evento', eventoId);
}

export function disconnectSocket(): void {
  joinedEventoIds.clear();
  joinedCervejariaId = null;
  if (socket?.connected) socket.disconnect();
}
