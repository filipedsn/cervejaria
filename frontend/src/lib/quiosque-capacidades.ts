export const QUIOSQUE_CAPACIDADES_INVALIDATION_KEYS = [
  ['quiosque-contexto'],
  ['quiosque-cozinha'],
  ['quiosque-estoque'],
] as const;

export function mensagemConfirmacaoEstoque(ativar: boolean): string {
  return ativar
    ? 'As vendas realizadas enquanto o controle de estoque estava desativado não foram refletidas no saldo. Revise as quantidades antes de voltar a controlar o estoque. Deseja continuar?'
    : 'A partir desta alteração, novas vendas não movimentarão o estoque. Os saldos e históricos existentes serão preservados. Deseja continuar?';
}

export function modoEmpresa(cervejaria: boolean, quiosque: boolean): 'Cervejaria' | 'Quiosque' | 'Híbrida' {
  if (cervejaria && quiosque) return 'Híbrida';
  return quiosque ? 'Quiosque' : 'Cervejaria';
}
