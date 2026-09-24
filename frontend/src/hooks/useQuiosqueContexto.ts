import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export interface PontoVenda {
  id: string;
  nome: string;
  ativo: boolean;
}

export type QuiosqueContexto = {
  ativo: boolean;
  operationMode: 'CAIXA' | 'EVENTO' | null;
  plannedOperationsEnabled: boolean;
  cashRegisterEnabled: boolean;
  tapsEnabled: boolean;
  inventoryEnabled: boolean;
  kitchenEnabled: boolean;
  controlaEstoque: boolean;
  temCozinha: boolean;
  usaCardapio: boolean;
  quantidadeMesas: number;
  pontosVenda: PontoVenda[];
};

const CONTEXTO_INATIVO: QuiosqueContexto = {
  ativo: false,
  operationMode: null,
  plannedOperationsEnabled: false,
  cashRegisterEnabled: false,
  tapsEnabled: false,
  inventoryEnabled: false,
  kitchenEnabled: false,
  controlaEstoque: false,
  temCozinha: false,
  usaCardapio: false,
  quantidadeMesas: 0,
  pontosVenda: [],
};

/**
 * Decide se o modulo Quiosque aparece para a empresa logada. Enquanto carrega,
 * responde inativo para nao piscar a navegacao do quiosque em quem nao o tem.
 */
export function useQuiosqueContexto() {
  const { cervejaria, isAdmin, isAuthenticated } = useAuth();
  const cervejariaId = cervejaria?.id ?? null;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['quiosque-contexto', cervejariaId],
    queryFn: () => api.get<QuiosqueContexto>('/api/quiosque/contexto'),
    enabled: isAuthenticated && !isAdmin && Boolean(cervejariaId),
    staleTime: 5 * 60 * 1000,
  });

  const aguardando =
    isAuthenticated && !isAdmin && Boolean(cervejariaId) && (isLoading || (isFetching && !data));

  return { contexto: data ?? CONTEXTO_INATIVO, isLoading: aguardando };
}
