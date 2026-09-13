import type { FastifyInstance } from 'fastify';
import { getOnboardingReadiness } from '../lib/onboarding/readiness.js';
import { getTenantUser } from '../types/auth.js';

/**
 * Operational readiness only. It deliberately has no input and no mutations:
 * tenant scope is always taken from the authenticated session.
 */
export async function onboardingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireTenant);

  app.get('/readiness', async (request) => {
    const user = getTenantUser(app, request);
    return getOnboardingReadiness(user.cervejariaId, user.papel === 'DONO');
  });
}
