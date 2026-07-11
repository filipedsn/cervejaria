import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { Evento, Trailer } from '../types';
import { api } from '../lib/api';
import { joinEvento, leaveEvento, getSocket } from '../lib/socket';
import { useAuth } from './AuthContext';

const TRAILER_STORAGE_KEY = 'trailerAtivo';
const EVENTO_STORAGE_KEY = 'eventoAtivo';

function readStoredTrailerId(): string | null {
  return localStorage.getItem(TRAILER_STORAGE_KEY);
}

function migrateTrailerIdFromEvento(): string | null {
  const saved = localStorage.getItem(EVENTO_STORAGE_KEY);
  if (!saved) return null;
  try {
    const evento: Evento = JSON.parse(saved);
    return evento.trailerId ?? null;
  } catch {
    return null;
  }
}

interface EventoContextType {
  trailerId: string | null;
  trailer: Trailer | null;
  evento: Evento | null;
  eventosAbertos: Evento[];
  trailers: Trailer[];
  setTrailer: (id: string) => void;
  clearTrailer: () => void;
  setEvento: (evento: Evento | null) => void;
  canChangeTrailer: boolean;
  isLoading: boolean;
  needsTrailerSelection: boolean;
  refreshEvento: () => Promise<void>;
  refreshOperacional: () => Promise<void>;
}

const EventoContext = createContext<EventoContextType | null>(null);

export function EventoProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isDono } = useAuth();
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [eventosAbertos, setEventosAbertos] = useState<Evento[]>([]);
  const [trailerId, setTrailerIdState] = useState<string | null>(() => {
    return readStoredTrailerId() ?? migrateTrailerIdFromEvento();
  });
  const [evento, setEventoState] = useState<Evento | null>(() => {
    const saved = localStorage.getItem(EVENTO_STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoading, setIsLoading] = useState(false);

  const eventoRef = useRef(evento);
  eventoRef.current = evento;
  const trailerIdRef = useRef(trailerId);
  trailerIdRef.current = trailerId;
  const eventosAbertosRef = useRef(eventosAbertos);
  eventosAbertosRef.current = eventosAbertos;

  const applyTrailerSelection = useCallback((id: string | null, abertos: Evento[]) => {
    setTrailerIdState(id);
    if (id) localStorage.setItem(TRAILER_STORAGE_KEY, id);
    else localStorage.removeItem(TRAILER_STORAGE_KEY);

    const resolved = id ? abertos.find((e) => e.trailerId === id) ?? null : null;
    const prev = eventoRef.current;
    if (prev && prev.id !== resolved?.id) leaveEvento(prev.id);

    setEventoState(resolved);
    if (resolved) {
      localStorage.setItem(EVENTO_STORAGE_KEY, JSON.stringify(resolved));
      joinEvento(resolved.id);
    } else {
      localStorage.removeItem(EVENTO_STORAGE_KEY);
    }
  }, []);

  const setTrailer = useCallback(
    (id: string) => {
      applyTrailerSelection(id, eventosAbertosRef.current);
    },
    [applyTrailerSelection],
  );

  const clearTrailer = useCallback(() => {
    applyTrailerSelection(null, eventosAbertosRef.current);
  }, [applyTrailerSelection]);

  const setEvento = useCallback(
    (e: Evento | null) => {
      if (e) {
        setTrailerIdState(e.trailerId);
        localStorage.setItem(TRAILER_STORAGE_KEY, e.trailerId);

        const prev = eventoRef.current;
        if (prev && prev.id !== e.id) leaveEvento(prev.id);

        setEventoState(e);
        localStorage.setItem(EVENTO_STORAGE_KEY, JSON.stringify(e));
        joinEvento(e.id);
      } else {
        const prev = eventoRef.current;
        if (prev) leaveEvento(prev.id);
        setEventoState(null);
        localStorage.removeItem(EVENTO_STORAGE_KEY);
      }
    },
    [],
  );

  const refreshOperacional = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const [trailersData, abertos] = await Promise.all([
        api.get<Trailer[]>('/api/trailers?ativo=true'),
        api.get<Evento[]>('/api/eventos/ativos'),
      ]);

      setTrailers(trailersData);
      setEventosAbertos(abertos);
      eventosAbertosRef.current = abertos;

      let tid = trailerIdRef.current ?? readStoredTrailerId() ?? migrateTrailerIdFromEvento();
      if (tid && !trailersData.some((t) => t.id === tid)) tid = null;
      if (!tid && trailersData.length === 1) tid = trailersData[0].id;

      applyTrailerSelection(tid, abertos);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, applyTrailerSelection]);

  useEffect(() => {
    if (isAuthenticated) {
      void refreshOperacional();
    }
  }, [isAuthenticated, refreshOperacional]);

  useEffect(() => {
    if (evento) joinEvento(evento.id);
  }, [evento?.id]);

  useEffect(() => {
    const socket = getSocket();
    const handler = (updated: Evento) => {
      setEventosAbertos((prev) => {
        const next =
          updated.status === 'FECHADO'
            ? prev.filter((e) => e.id !== updated.id)
            : [...prev.filter((e) => e.id !== updated.id), updated];
        eventosAbertosRef.current = next;

        const currentTrailerId = trailerIdRef.current;
        if (currentTrailerId && updated.trailerId === currentTrailerId) {
          if (updated.status === 'FECHADO') {
            const prevEvento = eventoRef.current;
            if (prevEvento?.id === updated.id) {
              if (prevEvento) leaveEvento(prevEvento.id);
              setEventoState(null);
              localStorage.removeItem(EVENTO_STORAGE_KEY);
            }
          } else if (eventoRef.current?.id === updated.id || !eventoRef.current) {
            setEventoState(updated);
            localStorage.setItem(EVENTO_STORAGE_KEY, JSON.stringify(updated));
            joinEvento(updated.id);
          }
        }

        return next;
      });
    };
    socket.on('evento:updated', handler);
    const onDeleted = ({ id }: { id: string }) => {
      setEventosAbertos((prev) => {
        const next = prev.filter((e) => e.id !== id);
        eventosAbertosRef.current = next;
        return next;
      });
      const prevEvento = eventoRef.current;
      if (prevEvento?.id === id) {
        leaveEvento(id);
        setEventoState(null);
        localStorage.removeItem(EVENTO_STORAGE_KEY);
      }
    };
    socket.on('evento:deleted', onDeleted);
    return () => {
      socket.off('evento:updated', handler);
      socket.off('evento:deleted', onDeleted);
    };
  }, []);

  const trailer = trailers.find((t) => t.id === trailerId) ?? null;
  const needsTrailerSelection = trailers.length > 1 && !trailerId && !isLoading;

  return (
    <EventoContext.Provider
      value={{
        trailerId,
        trailer,
        evento,
        eventosAbertos,
        trailers,
        setTrailer,
        clearTrailer,
        setEvento,
        canChangeTrailer: isDono,
        isLoading,
        needsTrailerSelection,
        refreshEvento: refreshOperacional,
        refreshOperacional,
      }}
    >
      {children}
    </EventoContext.Provider>
  );
}

export function useEvento() {
  const ctx = useContext(EventoContext);
  if (!ctx) throw new Error('useEvento must be used within EventoProvider');
  return ctx;
}
