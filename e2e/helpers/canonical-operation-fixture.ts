import { expect } from '@playwright/test';
import { apiRequest } from './api';

export interface CanonicalPdv {
  id: string;
  nome: string;
  ativo: boolean;
}

/** Reuse the tenant's single active PDV; never provision an extra one in QA. */
export async function getCanonicalPdv(cookie: string): Promise<CanonicalPdv> {
  const response = await apiRequest<CanonicalPdv[]>('GET', '/api/operacao/pontos-venda', { cookie });
  expect(response.status, 'consulta dos pontos de venda').toBe(200);
  const active = response.data.filter((point) => point.ativo);
  expect(active, 'o tenant deve ter exatamente um PDV canônico ativo').toHaveLength(1);
  return active[0]!;
}

export async function getCashState(cookie: string, pdvId: string) {
  const response = await apiRequest<{ sessao: { id: string; status: string } | null }>(
    'GET',
    `/api/operacao/caixa?pontoVendaId=${encodeURIComponent(pdvId)}`,
    { cookie },
  );
  expect(response.status, 'consulta do caixa do PDV canônico').toBe(200);
  return response.data;
}
