import { prisma } from '../src/lib/prisma.js';

if (process.env.NODE_ENV !== 'development' || !process.env.DATABASE_URL?.includes('cervejaria_dev')) {
  throw new Error('Inventário permitido somente no banco DEV');
}

try {
  const empresas = await prisma.cervejaria.findMany({ select: { id: true, nome: true }, orderBy: { id: 'asc' } });
  const resultado = [];
  for (const empresa of empresas) {
    const cervejariaId = empresa.id;
    const [pdvs, trailers, produtos, clientes, eventos, agendas, ocorrencias, comandasEvento, comandasCaixa, caixasEvento, caixasOperacao] = await Promise.all([
      prisma.pontoVenda.count({ where: { cervejariaId } }),
      prisma.trailer.count({ where: { cervejariaId } }),
      prisma.produto.count({ where: { cervejariaId } }),
      prisma.cliente.count({ where: { cervejariaId } }),
      prisma.evento.count({ where: { cervejariaId } }),
      prisma.evento.count({ where: { cervejariaId, recorrencia: 'SEMANAL' } }),
      prisma.evento.count({ where: { cervejariaId, serieId: { not: null } } }),
      prisma.comanda.count({ where: { evento: { cervejariaId } } }),
      prisma.comanda.count({ where: { pontoVenda: { cervejariaId } } }),
      prisma.sessaoCaixaEvento.count({ where: { evento: { cervejariaId } } }),
      prisma.sessaoCaixaOperacao.count({ where: { cervejariaId } }),
    ]);
    resultado.push({ cervejariaId, nome: empresa.nome, pdvs, trailers, produtos, clientes, eventos, agendas, ocorrencias, comandasEvento, comandasCaixa, caixasEvento, caixasOperacao });
  }
  const foco = resultado.filter((item) => /CIA Maritima|Churrasquinho do Thiago/i.test(item.nome));
  const semPdv = resultado.filter((item) => item.pdvs === 0).length;
  const multiplosPdvs = resultado.filter((item) => item.pdvs > 1).length;
  console.log(JSON.stringify({
    ambiente: 'DEV',
    totalEmpresas: resultado.length,
    empresasSemPdv: semPdv,
    empresasComMultiplosPdvs: multiplosPdvs,
    empresas: process.argv.includes('--all') ? resultado : foco,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
