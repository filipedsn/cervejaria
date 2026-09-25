export const CAIXA_CAPACIDADES_INVALIDATION_KEYS = [
  ['operacao-contexto'],
  ['operacao-cozinha'],
  ['operacao-estoque'],
] as const;

export function mensagemConfirmacaoEstoque(ativar: boolean): string {
  return ativar
    ? 'As vendas realizadas enquanto o controle de estoque estava desativado não foram refletidas no saldo. Revise as quantidades antes de voltar a controlar o estoque. Deseja continuar?'
    : 'A partir desta alteração, novas vendas não movimentarão o estoque. Os saldos e históricos existentes serão preservados. Deseja continuar?';
}

export function modoEmpresa(cervejaria: boolean, operacao: boolean): 'Cervejaria' | 'Operacao' | 'Híbrida' {
  if (cervejaria && operacao) return 'Híbrida';
  return operacao ? 'Operacao' : 'Cervejaria';
}
