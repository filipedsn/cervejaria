import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scheduleVisibleServiceWorkerUpdateChecks,
  SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS,
} from '../src/lib/pwa-update-checks.ts';

test('checks for a PWA update every minute while visible, and skips background checks', async () => {
  let visible = false;
  let updateCount = 0;
  let scheduledCallback: (() => void) | undefined;
  let scheduledInterval = 0;
  const registration = {
    update: async () => {
      updateCount += 1;
    },
  };

  scheduleVisibleServiceWorkerUpdateChecks(
    registration,
    () => visible,
    (callback, intervalMs) => {
      scheduledCallback = callback;
      scheduledInterval = intervalMs;
      return 1;
    },
  );

  assert.equal(scheduledInterval, SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS);
  assert.ok(scheduledCallback);
  scheduledCallback();
  assert.equal(updateCount, 0);

  visible = true;
  scheduledCallback();
  await Promise.resolve();
  assert.equal(updateCount, 1);
});
