import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5197';
export default defineConfig({
  testDir: './e2e', testMatch: /portal-preview-controls\.spec\.ts/,
  workers: 1, retries: 0, reporter: 'list',
  outputDir: 'test-results/portal-preview-controls',
  use: { ...devices['Desktop Chrome'], hasTouch: true, baseURL, serviceWorkers: 'block' },
  webServer: process.env.E2E_SKIP_SERVER ? undefined : {
    command: 'npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5197 --strictPort',
    url: baseURL, reuseExistingServer: false, timeout: 120_000,
  },
});
