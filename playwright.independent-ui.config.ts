import { defineConfig, devices } from '@playwright/test';
import { assertTestProdWriteGuard } from './scripts/test-prod-write-guard.mjs';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5198';
assertTestProdWriteGuard({ apiBase: baseURL, context: 'independent-kitchen UI mocks' });

export default defineConfig({
  testDir: './e2e',
  testMatch: /independent-kitchen-orders\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL, serviceWorkers: 'block' },
  webServer: process.env.E2E_SKIP_SERVER ? undefined : {
    command: 'npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5198',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
