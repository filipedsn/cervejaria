import { defineConfig, devices } from '@playwright/test';
import { assertTestProdWriteGuard } from './scripts/test-prod-write-guard.mjs';

const baseURL = 'http://127.0.0.1:5198';
assertTestProdWriteGuard({ apiBase: baseURL, context: 'PDV settings reorganization mocked UI' });

export default defineConfig({
  testDir: './e2e',
  testMatch: /pdv-settings-reorg\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/pdv-settings-reorganization-20261009',
  use: { ...devices['Desktop Chrome'], baseURL, serviceWorkers: 'block' },
  webServer: {
    command: 'npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5198',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
