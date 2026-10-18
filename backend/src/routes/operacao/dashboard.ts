import type { FastifyInstance } from 'fastify';
import { buildOperacaoDashboard } from '../../lib/operacao/dashboard.js';
import { parseDashboardPeriodo } from '../../lib/operacao/dashboard-periodo.js';
import { requirePermissaoOuDono } from '../../lib/operacao/permissoes.js';

export async function dashboardOperacaoRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [requirePermissaoOuDono(app, 'dashboard.read')] }, async (request) => {
    const { cervejariaId } = request.operacao;
    const query = request.query as { ano?: string; mes?: string; pontoVendaId?: string };

    const result = parseDashboardPeriodo(query);
    if (!result.ok) throw app.httpErrors.badRequest(result.error);

    return buildOperacaoDashboard(cervejariaId, result.periodo.ano, result.periodo.mes, query.pontoVendaId);
  });
}
