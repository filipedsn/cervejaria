export const SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS = 60_000;

export type ServiceWorkerUpdateRegistration = { update: () => Promise<unknown> };
export type IntervalScheduler = (callback: () => void, intervalMs: number) => unknown;

export function checkForServiceWorkerUpdate(registration: ServiceWorkerUpdateRegistration): void {
  registration.update().catch(() => {
    // Offline ou falha transitória: a próxima verificação tenta novamente.
  });
}

export function scheduleVisibleServiceWorkerUpdateChecks(
  registration: ServiceWorkerUpdateRegistration,
  isVisible: () => boolean,
  scheduleInterval: IntervalScheduler,
): void {
  scheduleInterval(() => {
    if (isVisible()) checkForServiceWorkerUpdate(registration);
  }, SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS);
}
