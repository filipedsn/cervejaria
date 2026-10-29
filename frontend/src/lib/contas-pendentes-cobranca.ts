import type { ContaPendenteOperacao } from './operacao';
import { dataConsumoConta } from './contas-pendentes-grupo';

function formatCurrencyBr(valor: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function dataTurnoPt(conta: ContaPendenteOperacao): string {
  return new Date(dataConsumoConta(conta)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function resumoItens(conta: ContaPendenteOperacao): string {
  const quantidadesPorItem = new Map<string, number>();
  for (const item of conta.comanda.itens) {
    const nome = item.nome?.trim() || 'Item';
    quantidadesPorItem.set(nome, (quantidadesPorItem.get(nome) ?? 0) + item.quantidade);
  }
  return [...quantidadesPorItem.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nome, quantidade]) => `- ${quantidade}x ${nome}`)
    .join('\n');
}

export type PerfilCobrancaMensagem = {
  nome?: string | null;
  chavePix?: string | null;
};

/** Monta o texto de cobrança WhatsApp consolidado por cliente (1 ou N turnos). */
export function montarMensagemCobrancaContas(
  contas: ContaPendenteOperacao[],
  perfil?: PerfilCobrancaMensagem | null,
): string {
  if (contas.length === 0) return '';
  const cliente = contas[0].cliente;
  const total = contas.reduce((soma, conta) => soma + conta.saldo, 0);
  const chavePix = perfil?.chavePix?.trim();
  const linhasTurnos = contas.flatMap((conta) => {
    const pdv = conta.comanda.pontoVenda?.nome?.trim();
    const cabecalho = pdv
      ? `Turno ${dataTurnoPt(conta)} (${pdv}):`
      : `Turno ${dataTurnoPt(conta)}:`;
    const itens = resumoItens(conta);
    return [
      cabecalho,
      itens,
      `Saldo: ${formatCurrencyBr(conta.saldo)}`,
      '',
    ];
  });

  const intro = contas.length === 1
    ? `Passando para lembrar que ficou um saldo em aberto referente à sua comanda do dia ${dataTurnoPt(contas[0])}.`
    : `Passando para lembrar que ficou um saldo em aberto referente a ${contas.length} consumos:`;

  return [
    `Oi, ${cliente.nome}! Tudo bem?`,
    '',
    intro,
    '',
    ...(contas.length === 1
      ? ['Resumo do consumo:', resumoItens(contas[0]), `Valor pendente: ${formatCurrencyBr(total)}`]
      : [...linhasTurnos, `Valor total pendente: ${formatCurrencyBr(total)}`]),
    ...(chavePix
      ? [
          `Chave PIX: ${chavePix}`,
          'Você pode realizar o pagamento via PIX utilizando a chave acima.',
        ]
      : []),
    'Se já tiver feito o pagamento, favor enviar o comprovante.',
    '',
    'Qualquer dúvida, é só chamar a gente por aqui.',
    'Obrigado!',
    perfil?.nome ?? 'Nossa equipe',
  ].join('\n');
}
