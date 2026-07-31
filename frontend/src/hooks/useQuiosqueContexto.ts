import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface PontoVenda {
  id: string;
  nome: string;
  ativo: boolean;
}

export type QuiosqueContexto =
  | { ativo: false }
  | {
      ativo: true;
      controlaEstoque: boolean;
      temCozinha: boolean;
      /** Empresa que so opera quiosque: esconde a navegacao de cervejaria. */
      exclusivo: boolean;
      pontosVenda: PontoVenda[];
    };

const CONTEXTO_INATIVO: QuiosqueContexto = { ativo: false };

/**
 * Decide se o modulo Quiosque aparece para a empresa logada. Enquanto carrega,
 * responde inativo para nao piscar a navegacao do quiosque em quem nao o tem.
 */
export function useQuiosqueContexto() {
  const { data, isLoading } = useQuery({
    queryKey: ['quiosque-contexto'],
    queryFn: () => api.get<QuiosqueContexto>('/api/quiosque/contexto'),
    staleTime: 5 * 60 * 1000,
  });

  return { contexto: data ?? CONTEXTO_INATIVO, isLoading };
}
