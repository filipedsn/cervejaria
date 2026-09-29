import { registerSW } from 'virtual:pwa-register';
import {
  checkForServiceWorkerUpdate,
  scheduleVisibleServiceWorkerUpdateChecks,
} from './pwa-update-checks';

function bindUpdateChecks(registration: ServiceWorkerRegistration) {
  checkForServiceWorkerUpdate(registration);

  // Clientes com o PWA aberto podem ficar dias sem navegar ou recuperar foco.
  // Verifica periodicamente para aplicar releases sem depender de fechar o app.
  scheduleVisibleServiceWorkerUpdateChecks(
    registration,
    () => document.visibilityState === 'visible',
    (callback, intervalMs) => window.setInterval(callback, intervalMs),
  );

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForServiceWorkerUpdate(registration);
    }
  });

  window.addEventListener('focus', () => checkForServiceWorkerUpdate(registration));

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) checkForServiceWorkerUpdate(registration);
  });
}

/** Recarrega uma vez quando um SW novo assume o controle (bundle atualizado). */
function bindControllerReload() {
  let reloaded = false;
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

/** Verifica atualizações do PWA ao abrir o atalho ou retornar ao app. */
export function initPwaUpdateChecks(): void {
  if (!('serviceWorker' in navigator)) return;

  bindControllerReload();

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) bindUpdateChecks(registration);
    },
  });
}
