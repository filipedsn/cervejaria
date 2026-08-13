import type { FastifyInstance } from 'fastify';
import { getAuthUser } from '../../types/auth.js';
import { buildQuiosqueDashboard } from '../../lib/quiosque/dashboard.js';

export async function dashboardQuiosqueRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.requireDono] }, async (request) => {
    const { cervejariaId } = request.quiosque;
    const now = new Date();
    const query = request.query as { ano?: string; mes?: string; pontoVendaId?: string };

    const ano = Number.parseInt(query.ano ?? String(now.getFullYear()), 10);
    const mes = Number.parseInt(query.mes ?? String(now.getMonth() + 1), 10);
    if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
      throw app.httpErrors.badRequest('Período inválido');
    }

    return buildQuiosqueDashboard(cervejariaId, ano, mes, query.pontoVendaId);
  });
}
