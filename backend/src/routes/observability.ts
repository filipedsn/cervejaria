import type { FastifyInstance, FastifyRequest } from 'fastify';
import { handleKibanaAlertWebhook } from '../lib/kibana-alert-email.js';
import { verifySession } from '../lib/session.js';
import { logger } from '../lib/logger.js';
import { metrics, trace } from '@opentelemetry/api';
import { z } from 'zod';
import type { JwtPayload } from '../types/auth.js';
import { prisma } from '../lib/prisma.js';
import { registrarTransacao } from '../lib/transacao-log.js';

function verifyWebhookSecret(request: FastifyRequest): boolean {
  const secret = process.env.KIBANA_ALERT_WEBHOOK_SECRET?.trim();
  if (!secret) return false;

  const auth = request.headers.authorization;
  if (auth === `Bearer ${secret}`) return true;

  const token = request.headers['x-quiver-webhook-token'];
  if (typeof token === 'string' && token === secret) return true;

  return false;
}

export async function observabilityRoutes(app: FastifyInstance) {
  if (process.env.NODE_ENV === 'development') {
    const counter = metrics.getMeter('quiver-tap-diagnostics').createCounter('quiver.observability.probe.total');
    app.post('/dev-probe', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
      await verifySession(app, request);
      const user = request.user as JwtPayload;
      if (user.papel !== 'DONO') return reply.code(403).send({ error: 'Não autorizado' });
      const tenant = user.cervejariaId ? await prisma.cervejaria.findUnique({ where: { id: user.cervejariaId }, select: { id: true, slug: true } }) : null;
      if (!tenant?.slug.startsWith('tap96-dev-')) return reply.code(403).send({ error: 'Probe disponível somente em empresa sintética TAP-96' });
      const { probeId } = z.object({ probeId: z.string().uuid() }).parse(request.body);
      // Deliberately fake canaries verify the published transport's sanitizer.
      const canary = 'tap96-synthetic-secret-canary';
      const fields = { 'probe.id': probeId, 'test.synthetic': true, event: 'observability.dev_probe',
        authorization: `Bearer ${canary}`, nested: { password: canary, url: `postgresql://qa:${canary}@localhost/qa`, array: [{ accessToken: canary }] },
        err: Object.assign(new Error(`Bearer ${canary}`), { code: 'TAP96_SYNTHETIC' }),
      };
      // Fixed messages only: callers cannot submit text, severity or attributes.
      for (const level of ['info', 'warn', 'error'] as const) logger[level](fields, `DEV synthetic Pino ${level}`);
      const span = trace.getTracer('quiver-tap-diagnostics').startSpan('observability.dev_probe');
      span.setAttributes({ 'probe.id': probeId, 'test.synthetic': true, 'cervejaria.id': tenant.id, 'cervejaria.slug': tenant.slug }); span.end();
      try {
        await prisma.$transaction(async tx => {
          await registrarTransacao({ cervejariaId: tenant.id, tipo: 'COMANDA_CRIADA', entidadeTipo: 'Diagnostics', entidadeId: probeId }, tx);
          throw new Error('TAP96_SYNTHETIC_ROLLBACK');
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'TAP96_SYNTHETIC_ROLLBACK') throw error;
      }
      if (await prisma.transacaoLog.count({ where: { cervejariaId: tenant.id, entidadeId: probeId } })) throw new Error('Synthetic rollback unexpectedly persisted');
      counter.add(1, { 'cervejaria.id': user.cervejariaId ?? 'unknown' });
      return reply.code(204).send();
    });
  }
  app.post('/kibana-alert', async (request, reply) => {
    if (!verifyWebhookSecret(request)) {
      return reply.status(401).send({ error: 'Não autorizado' });
    }

    try {
      const result = await handleKibanaAlertWebhook(request.body);
      if (result.deduped) {
        return reply.status(202).send({ message: 'Alerta deduplicado (já enviado recentemente)' });
      }
      const parts: string[] = [];
      if (result.channels?.email) parts.push('e-mail');
      if (result.channels?.telegram) parts.push('Telegram');
      return { message: `Alerta enviado (${parts.join(' + ') || 'canal desconhecido'})` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao enviar alerta';
      return reply.status(503).send({ error: msg });
    }
  });
}
