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

export function resolveOperationLabel(action?: string, fallbackMessage?: string): string {
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
