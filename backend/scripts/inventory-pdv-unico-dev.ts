import { validateInventoryEnvironment } from './inventory-pdv-unico-env.js';

// Validate before importing prisma.ts, which instantiates the client at module load.
validateInventoryEnvironment(process.env);
const { prisma } = await import('../src/lib/prisma.js');

try {
  const resultado = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const empresas = await tx.cervejaria.findMany({ select: { id: true, nome: true }, orderBy: { id: 'asc' } });
    const rows = [];
    for (const empresa of empresas) {
      const cervejariaId = empresa.id;
      const [pdvs, trailers, produtos, clientes, eventos, agendas, ocorrencias, comandasEvento, comandasCaixa, comandasQuiosque, conflitosEventoCaixa, conflitosTenant, caixasEvento, caixasOperacao] = await Promise.all([
        tx.pontoVenda.count({ where: { cervejariaId } }),
        tx.trailer.count({ where: { cervejariaId } }),
        tx.produto.count({ where: { cervejariaId } }),
        tx.cliente.count({ where: { cervejariaId } }),
        tx.evento.count({ where: { cervejariaId } }),
        tx.evento.count({ where: { cervejariaId, recorrencia: 'SEMANAL' } }),
        tx.evento.count({ where: { cervejariaId, serieId: { not: null } } }),
        tx.comanda.count({ where: { origem: 'EVENTO', evento: { cervejariaId } } }),
        tx.comanda.count({ where: { origem: 'CAIXA', pontoVenda: { cervejariaId } } }),
        tx.comanda.count({ where: { origem: 'QUIOSQUE', pontoVenda: { cervejariaId } } }),
        tx.comanda.findMany({ where: { evento: { cervejariaId }, pontoVendaId: { not: null } }, select: { id: true, origem: true, eventoId: true, pontoVendaId: true } }),
        tx.comanda.findMany({ where: { evento: { cervejariaId }, pontoVenda: { cervejariaId: { not: cervejariaId } } }, select: { id: true, origem: true, eventoId: true, pontoVendaId: true } }),
        tx.sessaoCaixaEvento.count({ where: { evento: { cervejariaId } } }),
        tx.sessaoCaixaOperacao.count({ where: { cervejariaId } }),
      ]);
      rows.push({ cervejariaId, nome: empresa.nome, pdvs, trailers, produtos, clientes, eventos, agendas, ocorrencias, comandasEvento, comandasCaixa, comandasQuiosque, caixasEvento, caixasOperacao, conflitosVinculo: { eventoEPdv: conflitosEventoCaixa, tenantsDivergentes: conflitosTenant } });
    }
    return rows;
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
  const foco = resultado.filter((item) => /CIA Maritima|Churrasquinho do Thiago/i.test(item.nome));
  console.log(JSON.stringify({
    ambiente: 'DEV',
    totalEmpresas: resultado.length,
    empresasSemPdv: resultado.filter((item) => item.pdvs === 0).length,
    empresasComMultiplosPdvs: resultado.filter((item) => item.pdvs > 1).length,
    empresas: process.argv.includes('--all') ? resultado : foco,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
