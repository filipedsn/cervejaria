import { defineConfig, devices } from '@playwright/test';
import { assertTestProdWriteGuard } from './scripts/test-prod-write-guard.mjs';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5198';
assertTestProdWriteGuard({ apiBase: baseURL, context: 'agenda UI fixtures' });

export default defineConfig({
  testDir: './e2e',
  testMatch: /agenda-operacional\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL, serviceWorkers: 'block' },
  webServer: process.env.E2E_SKIP_SERVER ? undefined : {
    command: 'node node_modules/vite/bin/vite.js preview --configLoader runner --host 127.0.0.1 --port 5198',
    cwd: './frontend',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
