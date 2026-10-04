import type { Prisma } from '@prisma/client';

/** Tenant-scoped session photo. The caller owns transaction isolation and any read-only policy. */
export async function readPdvSessionSourceSnapshot(tx: Prisma.TransactionClient, companyId: string) {
  const [operationalSessions, eventSessions] = await Promise.all([
    (tx as any).sessaoCaixaOperacao.findMany({
      where: { cervejariaId: companyId, OR: [{ origemHistorica: null }, { origemHistorica: 'CAIXA' }] },
      select: {
        id: true, cervejariaId: true, pontoVendaId: true, trailerId: true, diaOperacional: true, status: true,
        trocoInicial: true, abertoPorId: true, abertoEm: true, fechadoPorId: true, fechadoEm: true,
        contadoDinheiro: true, contadoPix: true, contadoCartaoDebito: true, contadoCartaoCredito: true,
        contadoCartao: true, observacaoFechamento: true, cardapioId: true, ocorrenciaId: true,
        origemHistorica: true,
        pontoVenda: { select: { cervejariaId: true } },
        trailer: { select: { cervejariaId: true } },
        cardapio: { select: { cervejariaId: true, pontoVendaId: true } },
        produtos: { select: { id: true, sessaoCaixaId: true, produtoId: true, volumeMl: true, precoUnit: true, createdAt: true, produto: { select: { cervejariaId: true, pontoVendaId: true } } }, orderBy: [{ produtoId: 'asc' }, { volumeMl: 'asc' }, { id: 'asc' }] },
      },
      orderBy: { id: 'asc' },
    }),
    tx.sessaoCaixaEvento.findMany({
      where: { evento: { cervejariaId: companyId } },
      select: {
        id: true, eventoId: true, status: true, trocoInicial: true, abertoPorId: true, abertoEm: true,
        fechadoPorId: true, fechadoEm: true, contadoDinheiro: true, contadoPix: true,
        contadoDebito: true, contadoCredito: true, contadoCartao: true, observacaoFechamento: true,
        evento: { select: { id: true, cervejariaId: true, data: true, trailerId: true, cardapioId: true, trailer: { select: { cervejariaId: true } }, cardapio: { select: { cervejariaId: true } }, produtos: { select: { id: true, eventoId: true, produtoId: true, createdAt: true, produto: { select: { cervejariaId: true, pontoVendaId: true } } }, orderBy: { produtoId: 'asc' } } } },
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  return { companyId, operationalSessions, eventSessions };
}
