import type { OnboardingModule, OnboardingStepCode } from './onboarding';

export interface OnboardingVisualAction {
  code: OnboardingStepCode;
  module: OnboardingModule;
  title: string;
  detail: string;
  cta: string;
  to: string;
  target: string;
}

const ACTIONS: Record<OnboardingStepCode, Omit<OnboardingVisualAction, 'code' | 'module'>> = {
  QUIOSQUE_POINT: { title: 'Prepare seu ponto de venda.', detail: 'Escolha onde você vai atender.', cta: 'Ver operação', to: '/quiosque/configuracoes/operacao', target: 'quiosque-open-cash' },
  QUIOSQUE_PRODUCT: { title: 'Cadastre seu primeiro produto.', detail: 'Preço definido e venda direta em poucos toques.', cta: 'Adicionar produto', to: '/quiosque/catalogo', target: 'quiosque-add-product' },
  QUIOSQUE_STOCK: { title: 'Informe o saldo disponível.', detail: 'Só os produtos com estoque precisam dessa etapa.', cta: 'Revisar estoque', to: '/quiosque/estoque', target: 'quiosque-adjust-stock' },
  QUIOSQUE_CASH_REGISTER: { title: 'Abra o caixa para registrar vendas.', detail: 'Escolha o troco inicial e comece o turno.', cta: 'Abrir caixa', to: '/quiosque/caixa', target: 'quiosque-open-cash' },
  QUIOSQUE_FIRST_SALE: { title: 'Tudo pronto. Faça sua primeira venda.', detail: 'A operação já está pronta para atender.', cta: 'Fazer venda', to: '/quiosque/comandas/venda-avulsa', target: 'quiosque-start-sale' },
  CERVEJARIA_TRAILER: { title: 'Escolha o trailer da operação.', detail: 'Use o trailer principal para começar.', cta: 'Ver trailers', to: '/configuracoes/trailers', target: 'brewery-configure-tap' },
  CERVEJARIA_PRODUCT: { title: 'Cadastre seu primeiro chope.', detail: 'Defina um preço para começar a servir.', cta: 'Adicionar chope', to: '/configuracoes/catalogo', target: 'brewery-add-chope' },
  CERVEJARIA_TAP: { title: 'Associe o chope a um tap.', detail: 'Escolha um dos taps já disponíveis.', cta: 'Configurar tap', to: '/configuracoes/trailers', target: 'brewery-configure-tap' },
  CERVEJARIA_OPERATION: { title: 'Abra a operação.', detail: 'Inicie um evento para registrar as vendas.', cta: 'Abrir operação', to: '/eventos', target: 'brewery-open-operation' },
  CERVEJARIA_FIRST_SALE: { title: 'Tudo pronto. Faça sua primeira venda.', detail: 'Sirva o primeiro chope quando estiver pronto.', cta: 'Fazer venda', to: '/venda-avulsa', target: 'brewery-start-sale' },
};

export function getOnboardingVisualAction(code: OnboardingStepCode, module: OnboardingModule): OnboardingVisualAction | null {
  if (!code.startsWith(`${module}_`)) return null;
  return { code, module, ...ACTIONS[code] };
}
