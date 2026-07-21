import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getVapidPublicKey } from '../lib/push-notifications.js';
import { getAuthUser } from '../types/auth.js';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function pushRoutes(app: FastifyInstance) {
  app.get('/vapid-public-key', async () => {
    const publicKey = getVapidPublicKey();
    if (!publicKey) {
      return { enabled: false as const, publicKey: null };
    }
    return { enabled: true as const, publicKey };
  });

  app.post('/subscribe', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!user.cervejariaId) {
      return reply.status(403).send({ error: 'Usuário sem cervejaria' });
    }

    const body = subscribeSchema.parse(request.body);

    await prisma.pushSubscription.upsert({
      where: {
        usuarioId_endpoint: {
          usuarioId: user.sub,
          endpoint: body.endpoint,
        },
      },
      create: {
        usuarioId: user.sub,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    return { ok: true };
  });

  app.delete('/subscribe', { preHandler: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    const body = unsubscribeSchema.parse(request.body);

    await prisma.pushSubscription.deleteMany({
      where: {
        usuarioId: user.sub,
        endpoint: body.endpoint,
      },
    });

    return { ok: true };
  });
}
