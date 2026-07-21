import webpush from 'web-push';
import { prisma } from './prisma.js';

let vapidConfigured = false;

function configureVapid(): boolean {
  if (vapidConfigured) return true;

  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() ?? 'mailto:contato@quivercloud.com.br';

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() ?? null;
}

export function isPushConfigured(): boolean {
  return configureVapid();
}

type PedidoPushPayload = {
  pedidoId: string;
  eventoId: string;
  clienteNome: string;
  resumoItens: string;
  pendenteCount?: number;
};

function buildNotificationPayload(payload: PedidoPushPayload) {
  const title = payload.pendenteCount && payload.pendenteCount > 1
    ? `${payload.pendenteCount} pedidos pendentes`
    : 'Novo pedido do cliente';

  const body = payload.pendenteCount && payload.pendenteCount > 1
    ? `Último: ${payload.clienteNome} — ${payload.resumoItens}`
    : `${payload.clienteNome} — ${payload.resumoItens}`;

  return JSON.stringify({
    title,
    body,
    url: '/comandas',
    tag: `pedido-${payload.pedidoId}`,
  });
}

async function removeStaleSubscription(id: string) {
  await prisma.pushSubscription.delete({ where: { id } }).catch(() => undefined);
}

export async function notifyPedidoCreated(
  cervejariaId: string,
  payload: PedidoPushPayload,
): Promise<void> {
  if (!configureVapid()) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      usuario: { cervejariaId },
    },
  });

  if (subscriptions.length === 0) return;

  const notification = buildNotificationPayload(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          notification,
          { TTL: 60, urgency: 'high' },
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await removeStaleSubscription(sub.id);
        }
      }
    }),
  );
}
