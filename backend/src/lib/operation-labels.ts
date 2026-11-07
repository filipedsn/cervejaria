/** Rotulos legiveis para event.action dos logs de auditoria. */

const OPERATION_LABELS: Record<string, string> = {
  'transacao.comanda_criada': 'Abrir comanda',
  'transacao.comanda_item_adicionado': 'Incluir item na comanda',
  'transacao.comanda_item_removido': 'Remover item da comanda',
  'transacao.comanda_desconto_aplicado': 'Aplicar desconto na comanda',
  'transacao.comanda_fechada': 'Fechar comanda',
  'transacao.comanda_cancelada': 'Cancelar comanda',
  'transacao.evento_criado': 'Criar evento',
  'transacao.evento_sessao_iniciada': 'Iniciar sessao do evento',
  'transacao.evento_atualizado': 'Atualizar evento',
  'transacao.evento_fechado': 'Encerrar evento',
  'transacao.evento_reaberto': 'Reabrir evento',
  'transacao.evento_excluido': 'Excluir evento',
  'transacao.evento_cardapio_atualizado': 'Atualizar cardapio do evento',
  'transacao.tap_chope_posicionado': 'Posicionar chope no tap',
  'transacao.tap_chope_removido': 'Remover chope do tap',
  'transacao.tap_ativo_alterado': 'Alterar tap ativo',
  'transacao.operacao_caixa_aberto': 'Abrir caixa do operacao',
  'transacao.operacao_caixa_movimento': 'Movimentar caixa do operacao',
  'transacao.operacao_caixa_fechado': 'Fechar caixa do operacao',
  'transacao.operacao_comanda_criada': 'Abrir comanda do operacao',
  'transacao.operacao_comanda_fechada': 'Fechar comanda do operacao',
  'transacao.operacao_comanda_cancelada': 'Cancelar comanda do operacao',
  'transacao.operacao_pedido_criado': 'Criar pedido no operacao',
  'transacao.operacao_pagamento_registrado': 'Registrar pagamento no operacao',
  'transacao.operacao_comanda_grupo_fechado': 'Fechar grupo de comandas',
  'transacao.operacao_pedido_cozinha': 'Atualizar pedido da cozinha',
  'transacao.operacao_estoque_movimento': 'Movimentar estoque',
  'transacao.operacao_desconto_aplicado': 'Aplicar desconto',
  'transacao.operacao_venda_avulsa': 'Registrar venda avulsa',
  'transacao.portal_pedido_criado': 'Criar pedido pelo portal',
  'transacao.portal_pedido_recusado': 'Recusar pedido do portal',
  'ui.error': 'Erro na tela do app',
  'ui.click': 'Acao na tela',
  'ui.page_view': 'Abrir pagina',
};

function humanizeActionToken(token: string): string {
  return token
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Rotulo de negocio a partir da rota HTTP (ex.: portal PDV). */
export function resolveRouteOperationLabel(route?: string, method?: string): string | undefined {
  if (!route?.trim()) return undefined;
  const r = route.trim().toLowerCase();
  const m = (method ?? '').toUpperCase();

  if (r.includes('/api/public/') && r.includes('/pontos-venda/') && /\/comanda\/?$/.test(r)) {
    return m === 'GET' || !m
      ? 'Consultar comanda/cardapio do cliente (portal PDV)'
      : 'Atualizar comanda do cliente (portal PDV)';
  }
  if (r.includes('/api/public/') && r.includes('/cardapio')) {
    return 'Consultar cardapio publico';
  }
  if (r === '/api/auth/login' || r.endsWith('/api/auth/login')) {
    return 'Login';
  }
  if (r === '/api/auth/me' || r.endsWith('/api/auth/me')) {
    return 'Verificar sessao';
  }
  return undefined;
}

/** Normaliza ids dinamicos da URL de UI para comparar padroes. */
export function normalizeUiPath(path?: string): string | undefined {
  if (!path?.trim()) return undefined;
  let normalized = path.trim().split('?')[0] ?? path.trim();
  try {
    normalized = new URL(normalized, 'http://frontend.local').pathname;
  } catch {
    // keep as-is
  }
  return normalized
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .replace(/\/[a-z0-9_-]{16,}(?=\/|$)/gi, '/:id')
    .toLowerCase() || '/';
}

/**
 * Funcionalidade legivel a partir de ui.page / ui.route do frontend.
 * Ex.: /operacao/comandas/:id → Detalhe da comanda (Operacao)
 */
export function resolveUiFeatureLabel(path?: string): string | undefined {
  const p = normalizeUiPath(path);
  if (!p) return undefined;

  const exact: Record<string, string> = {
    '/': 'Inicio',
    '/login': 'Login',
    '/operacao': 'Operacao',
    '/operacao/comandas': 'Lista de comandas (Operacao)',
    '/operacao/comandas/nova': 'Nova comanda (Operacao)',
    '/operacao/comandas/:id': 'Detalhe da comanda (Operacao)',
    '/operacao/caixa': 'Caixa (Operacao)',
    '/operacao/cozinha': 'Cozinha (Operacao)',
    '/operacao/estoque': 'Estoque (Operacao)',
    '/operacao/catalogo': 'Catalogo (Operacao)',
    '/operacao/venda-avulsa': 'Venda avulsa (Operacao)',
    '/operacao/contas-pendentes': 'Contas pendentes (Operacao)',
    '/operacao/dashboard': 'Dashboard (Operacao)',
    '/comandas': 'Lista de comandas',
    '/comandas/:id': 'Detalhe da comanda',
    '/caixa': 'Caixa',
    '/cozinha': 'Cozinha',
    '/estoque': 'Estoque',
    '/dashboard': 'Dashboard',
    '/cardapios': 'Cardapios',
    '/produtos': 'Produtos',
    '/clientes': 'Clientes',
    '/clientes/:id': 'Detalhe do cliente',
    '/admin/cervejarias': 'Admin de cervejarias',
  };

  if (exact[p]) return exact[p];

  if (p.startsWith('/operacao/comandas/')) return 'Detalhe da comanda (Operacao)';
  if (p.startsWith('/operacao/')) {
    const rest = p.replace('/operacao/', '').split('/')[0] ?? '';
    if (rest) return `${humanizeActionToken(rest)} (Operacao)`;
    return 'Operacao';
  }
  if (p.startsWith('/portal') || p.includes('/p/')) return 'Portal do cliente';

  const leaf = p.split('/').filter(Boolean).pop();
  if (leaf && leaf !== ':id') return humanizeActionToken(leaf.replace(/-/g, '_'));
  return undefined;
}

export function resolveOperationLabel(
  action?: string,
  fallbackMessage?: string,
  route?: string,
  method?: string,
): string {
  const fromRoute = resolveRouteOperationLabel(route, method);
  if (fromRoute) return fromRoute;

  const key = action?.trim().toLowerCase();
  if (key && OPERATION_LABELS[key]) return OPERATION_LABELS[key];

  if (key?.startsWith('transacao.')) {
    return humanizeActionToken(key.replace('transacao.', ''));
  }

  if (key?.startsWith('ui.')) {
    return humanizeActionToken(key.replace('ui.', ''));
  }

  if (key?.startsWith('http.')) {
    return `Requisicao HTTP (${key.replace('http.', '')})`;
  }

  if (key) return humanizeActionToken(key.replace(/\./g, '_'));

  const msg = fallbackMessage?.trim();
  if (msg) return msg.length > 80 ? `${msg.slice(0, 77)}...` : msg;

  return 'Nao identificada';
}

export function slugToDisplayName(slug?: string): string | undefined {
  if (!slug?.trim()) return undefined;
  return slug
    .trim()
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
