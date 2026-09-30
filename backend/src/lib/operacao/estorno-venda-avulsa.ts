import type { PaymentMethod, Prisma } from '@prisma/client';
import { centavos, reais } from './venda.js';

type PagamentoSaldo = { forma: PaymentMethod; valor: unknown };

/** Mantém o histórico dos pagamentos originais; lançamentos negativos compensam o caixa. */
export function distribuirEstorno(pagamentos: PagamentoSaldo[], valorCentavos: number) {
  const saldos = new Map<PaymentMethod, number>();
  for (const pagamento of pagamentos) {
    saldos.set(pagamento.forma, (saldos.get(pagamento.forma) ?? 0) + centavos(pagamento.valor));
  }
  const resultado: Array<{ forma: PaymentMethod; valor: number }> = [];
  let restante = valorCentavos;
  for (const [forma, saldo] of saldos) {
    if (saldo <= 0 || restante <= 0) continue;
    const parcela = Math.min(saldo, restante);
    resultado.push({ forma, valor: -reais(parcela) });
    restante -= parcela;
  }
  if (restante !== 0) throw Object.assign(new Error('Pagamentos insuficientes para estornar a venda'), { statusCode: 409 });
  return resultado;
}

export async function estornarVendaAvulsaFechada(
  tx: Prisma.TransactionClient,
  params: { comandaId: string; registradoPorId: string; sessaoCaixaId?: string; sessaoCaixaEventoId?: string },
) {
  const comanda = await tx.comanda.findUniqueOrThrow({
    where: { id: params.comandaId },
    include: { itens: true, pagamentos: true },
  });
  if (comanda.tipo !== 'AVULSA' || comanda.status !== 'FECHADA') {
    throw Object.assign(new Error('Esta venda avulsa não pode ser estornada'), { statusCode: 409 });
  }

  const totalAnterior = centavos(comanda.total);
  const pago = comanda.pagamentos.reduce((soma, pagamento) => soma + centavos(pagamento.valor), 0);
  if (pago !== totalAnterior) {
    throw Object.assign(new Error('O saldo de pagamentos não confere com a venda; confira o caixa antes de cancelar'), { statusCode: 409 });
  }
  const subtotal = comanda.itens
    .filter((item) => !item.cancelamentoPendenteEm && !item.canceladoEm)
    .reduce((soma, item) => soma + centavos(item.precoUnit) * item.quantidade, 0);
  const desconto = Math.min(centavos(comanda.desconto), subtotal);
  const totalNovo = Math.max(0, subtotal - desconto);
  const estorno = totalAnterior - totalNovo;
  if (estorno < 0) {
    throw Object.assign(new Error('O cancelamento não pode aumentar o valor da venda'), { statusCode: 409 });
  }

  const parcelas = distribuirEstorno(comanda.pagamentos, estorno);
  if (parcelas.length) {
    await tx.pagamento.createMany({
      data: parcelas.map(({ forma, valor }) => ({
        comandaId: comanda.id,
        forma,
        valor,
        registradoPorId: params.registradoPorId,
        sessaoCaixaId: params.sessaoCaixaId ?? null,
        sessaoCaixaEventoId: params.sessaoCaixaEventoId ?? null,
      })),
    });
  }
  await tx.comanda.update({
    where: { id: comanda.id },
    data: {
      total: reais(totalNovo),
      desconto: reais(desconto),
      ...(totalNovo === 0 && comanda.itens.every((item) => Boolean(item.cancelamentoPendenteEm || item.canceladoEm))
        ? { status: 'CANCELADA' as const }
        : {}),
    },
  });
  return { valorEstornado: reais(estorno), totalNovo: reais(totalNovo) };
}
