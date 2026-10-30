import type { FastifyInstance } from 'fastify';
import { parseCervejariaDashboardPeriodo } from '../../lib/cervejaria-dashboard-periodo.js';
import { buildOperacaoDashboard } from '../../lib/operacao/dashboard.js';
import { requirePermissaoOuDono } from '../../lib/operacao/permissoes.js';

export async function dashboardOperacaoRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [requirePermissaoOuDono(app, 'dashboard.read')] }, async (request) => {
    const { cervejariaId } = request.operacao;
    const query = request.query as {
      modo?: string;
      ano?: string;
      mes?: string;
      de?: string;
      ate?: string;
      pontoVendaId?: string;
    };

    const result = parseCervejariaDashboardPeriodo(query);
    if (!result.ok) throw app.httpErrors.badRequest(result.error);

    return buildOperacaoDashboard(cervejariaId, result.periodo, query.pontoVendaId);
  });
}
