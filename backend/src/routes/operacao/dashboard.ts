import type { FastifyInstance } from 'fastify';
import { getAuthUser } from '../../types/auth.js';
import { buildOperacaoDashboard } from '../../lib/operacao/dashboard.js';
import { requirePermissaoOuDono } from '../../lib/operacao/permissoes.js';

export async function dashboardOperacaoRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [requirePermissaoOuDono(app, 'dashboard.read')] }, async (request) => {
    const { cervejariaId } = request.operacao;
    const now = new Date();
    const query = request.query as { ano?: string; mes?: string; pontoVendaId?: string };

    const ano = Number.parseInt(query.ano ?? String(now.getFullYear()), 10);
    const mes = Number.parseInt(query.mes ?? String(now.getMonth() + 1), 10);
    if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
      throw app.httpErrors.badRequest('Período inválido');
    }

    return buildOperacaoDashboard(cervejariaId, ano, mes, query.pontoVendaId);
  });
}
