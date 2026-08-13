import { useAuth } from '../contexts/AuthContext';

/** Retorna intervalo de polling só quando autenticado; evita cascade de 401. */
export function usePollInterval(ms: number): number | false {
  const { isAuthenticated, isLoading } = useAuth();
  if (!isAuthenticated || isLoading) return false;
  return ms;
}
