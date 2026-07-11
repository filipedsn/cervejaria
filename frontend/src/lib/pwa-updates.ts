import { registerSW } from 'virtual:pwa-register';

function checkForServiceWorkerUpdate(registration: ServiceWorkerRegistration) {
  registration.update().catch(() => {
    /* offline ou erro transitório */
  });
}

function bindUpdateChecks(registration: ServiceWorkerRegistration) {
  checkForServiceWorkerUpdate(registration);

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

/** Verifica atualizações do PWA ao abrir o atalho ou retornar ao app. */
export function initPwaUpdateChecks(): void {
  if (!('serviceWorker' in navigator)) return;

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) bindUpdateChecks(registration);
    },
  });
}
