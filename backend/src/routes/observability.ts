import type { FastifyInstance, FastifyRequest } from 'fastify';
import { handleKibanaAlertWebhook } from '../lib/kibana-alert-email.js';

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
