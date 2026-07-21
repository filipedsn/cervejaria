/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

type PushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
};

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  const fallback: PushPayload = {
    title: 'Novo pedido do cliente',
    body: 'Confira a fila de pedidos',
    url: '/comandas',
    tag: 'pedido-pendente',
  };

  let payload = fallback;
  try {
    if (event.data) {
      payload = { ...fallback, ...event.data.json() };
    }
  } catch {
    // usa fallback
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? fallback.title!, {
      body: payload.body ?? fallback.body,
      icon: '/icons/pwa-192.png',
      badge: '/icons/pwa-192.png',
      tag: payload.tag ?? fallback.tag,
      renotify: true,
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
      silent: false,
      data: { url: payload.url ?? fallback.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string | undefined) ?? '/comandas';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          void client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
