import { defineConfig, devices } from '@playwright/test';
import { assertTestProdWriteGuard } from './scripts/test-prod-write-guard.mjs';
const baseURL = 'http://127.0.0.1:5197';
assertTestProdWriteGuard({ apiBase: baseURL, context: 'PDV settings mocked UI' });
export default defineConfig({
  testDir: './e2e', testMatch: /pdv-settings\.spec\.ts/, workers: 1, retries: 0,
  reporter: 'list', outputDir: 'test-results/pdv-settings',
  use: { ...devices['Desktop Chrome'], baseURL, serviceWorkers: 'block' },
  webServer: { command: 'npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5197', url: baseURL, reuseExistingServer: false, timeout: 120_000 },
});
