import type { FastifyInstance } from 'fastify';
import { parseCervejariaDashboardPeriodo } from '../../lib/cervejaria-dashboard-periodo.js';
import { buildOperacaoDashboard } from '../../lib/operacao/dashboard.js';
import {
  buildDashboardProdutoDetalhe,
  buildDashboardProdutosLista,
} from '../../lib/operacao/dashboard-produtos.js';
import { requirePermissaoOuDono } from '../../lib/operacao/permissoes.js';

function parseDashboardQuery(query: Record<string, unknown>) {
  return {
    modo: typeof query.modo === 'string' ? query.modo : undefined,
    ano: typeof query.ano === 'string' ? query.ano : undefined,
    mes: typeof query.mes === 'string' ? query.mes : undefined,
    de: typeof query.de === 'string' ? query.de : undefined,
    ate: typeof query.ate === 'string' ? query.ate : undefined,
    pontoVendaId: typeof query.pontoVendaId === 'string' && query.pontoVendaId.trim()
      ? query.pontoVendaId.trim()
      : undefined,
    incluirZerados: query.incluirZerados === '1' || query.incluirZerados === 'true',
  };
}

export async function dashboardOperacaoRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [requirePermissaoOuDono(app, 'dashboard.read')] }, async (request) => {
    const { cervejariaId } = request.operacao;
    const query = parseDashboardQuery(request.query as Record<string, unknown>);

    const result = parseCervejariaDashboardPeriodo(query);
    if (!result.ok) throw app.httpErrors.badRequest(result.error);

    return buildOperacaoDashboard(cervejariaId, result.periodo, query.pontoVendaId);
  });

  app.get('/produtos', { preHandler: [requirePermissaoOuDono(app, 'dashboard.read')] }, async (request) => {
    const { cervejariaId, controlaEstoque } = request.operacao;
    const query = parseDashboardQuery(request.query as Record<string, unknown>);
    const result = parseCervejariaDashboardPeriodo(query);
    if (!result.ok) throw app.httpErrors.badRequest(result.error);

    return buildDashboardProdutosLista(cervejariaId, result.periodo, {
      pontoVendaId: query.pontoVendaId,
      controlaEstoque,
      incluirZerados: query.incluirZerados,
    });
  });

  app.get<{ Params: { produtoId: string } }>(
    '/produtos/:produtoId',
    { preHandler: [requirePermissaoOuDono(app, 'dashboard.read')] },
    async (request) => {
      const { cervejariaId, controlaEstoque } = request.operacao;
      const query = parseDashboardQuery(request.query as Record<string, unknown>);
      const result = parseCervejariaDashboardPeriodo(query);
      if (!result.ok) throw app.httpErrors.badRequest(result.error);

      const detalhe = await buildDashboardProdutoDetalhe(
        cervejariaId,
        request.params.produtoId,
        result.periodo,
        { pontoVendaId: query.pontoVendaId, controlaEstoque },
      );
      if (!detalhe) throw app.httpErrors.notFound('Produto não encontrado');
      return detalhe;
    },
  );
}
