import type { Prisma } from '@prisma/client';

/** Tenant-wide, transaction-owned photograph. Importing this module does not connect. */
export async function readPdvFinanceSourceSnapshot(tx: Prisma.TransactionClient, companyId: string) {
  const commandWhere = {
    OR: [
      { evento: { cervejariaId: companyId } },
      { pontoVenda: { cervejariaId: companyId } },
    ],
  };
  const [payments, debts, eventMovements, operationalMovements] = await Promise.all([
    tx.pagamento.findMany({ where: { comanda: commandWhere }, include: {
      comanda: { include: { evento: { select: { id: true, cervejariaId: true } }, pontoVenda: { select: { id: true, cervejariaId: true } } } },
      contaReceber: { include: { cliente: { select: { cervejariaId: true } } } },
      sessaoCaixaEvento: { include: { evento: { select: { id: true, cervejariaId: true } } } },
      sessaoCaixaOperacao: { select: { id: true, cervejariaId: true, pontoVendaId: true, origemHistorica: true } },
    }, orderBy: { id: 'asc' } }),
    tx.contaReceber.findMany({ where: { comanda: commandWhere }, include: {
      cliente: { select: { cervejariaId: true } },
      comanda: { include: { evento: { select: { id: true, cervejariaId: true } }, pontoVenda: { select: { id: true, cervejariaId: true } } } },
      pagamentos: { select: { id: true, forma: true, valor: true, sessaoCaixaId: true, sessaoCaixaEventoId: true }, orderBy: { id: 'asc' } },
    }, orderBy: { id: 'asc' } }),
    tx.movimentoCaixaEvento.findMany({ where: { sessao: { evento: { cervejariaId: companyId } } }, include: {
      sessao: { include: { evento: { select: { id: true, cervejariaId: true } } } },
    }, orderBy: { id: 'asc' } }),
    tx.movimentoCaixaOperacao.findMany({ where: { sessao: { cervejariaId: companyId, OR: [{ origemHistorica: null }, { origemHistorica: 'CAIXA' }] } }, include: {
      sessao: { select: { id: true, cervejariaId: true, pontoVendaId: true } },
    }, orderBy: { id: 'asc' } }),
  ]);
  return { companyId, payments, debts, eventMovements, operationalMovements };
}
