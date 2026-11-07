import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export interface PontoVenda {
  id: string;
  nome: string;
  ativo: boolean;
}

export type OperacaoContexto = {
  ativo: boolean;
  operationMode: 'CAIXA' | 'EVENTO' | null;
  plannedOperationsEnabled: boolean;
  cashRegisterEnabled: boolean;
  tapsEnabled: boolean;
  operationalSettingsSource?: 'LEGACY' | 'CANONICAL_PDV';
  inventoryEnabled: boolean;
  kitchenEnabled: boolean;
  kitchenItemsChargeAtLaunch: boolean;
  allowCloseComandaWithPendingKitchenOrders: boolean;
  barEnabled: boolean;
  barItemsChargeAtLaunch: boolean;
  allowCloseComandaWithPendingBarOrders: boolean;
  agendaEnabled: boolean;
  controlaEstoque: boolean;
  temCozinha: boolean;
  temBar: boolean;
  temAgenda: boolean;
  usaCardapio: boolean;
  quantidadeMesas: number;
  whatsappPedidoProntoEnabled: boolean;
  whatsappPedidoProntoNaCozinha: boolean;
  whatsappPedidoProntoNoBar: boolean;
  pontosVenda: PontoVenda[];
};

const CONTEXTO_INATIVO: OperacaoContexto = {
  ativo: false,
  operationMode: null,
  plannedOperationsEnabled: false,
  cashRegisterEnabled: false,
  tapsEnabled: false,
  operationalSettingsSource: 'LEGACY',
  inventoryEnabled: false,
  kitchenEnabled: false,
  kitchenItemsChargeAtLaunch: false,
  allowCloseComandaWithPendingKitchenOrders: false,
  barEnabled: false,
  barItemsChargeAtLaunch: false,
  allowCloseComandaWithPendingBarOrders: false,
  agendaEnabled: true,
  controlaEstoque: false,
  temCozinha: false,
  temBar: false,
  temAgenda: true,
  usaCardapio: false,
  quantidadeMesas: 0,
  whatsappPedidoProntoEnabled: false,
  whatsappPedidoProntoNaCozinha: false,
  whatsappPedidoProntoNoBar: false,
  pontosVenda: [],
};

/**
 * Decide se o modulo Operacao aparece para a empresa logada. Enquanto carrega,
 * responde inativo para nao piscar a navegacao do operacao em quem nao o tem.
 */
export function useOperacaoContexto() {
  const { cervejaria, isAdmin, isAuthenticated } = useAuth();
  const cervejariaId = cervejaria?.id ?? null;

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['operacao-contexto', cervejariaId],
    queryFn: () => api.get<OperacaoContexto>('/api/operacao/contexto'),
    enabled: isAuthenticated && !isAdmin && Boolean(cervejariaId),
    staleTime: 5 * 60 * 1000,
  });

  const aguardando =
    isAuthenticated && !isAdmin && Boolean(cervejariaId) && (isLoading || (isFetching && !data));

  return { contexto: data ?? CONTEXTO_INATIVO, isLoading: aguardando, isResolved: Boolean(data) && !isError, isError };
}
