import { defineConfig, devices } from '@playwright/test';

// Frontend only. Every API/upload request is intercepted; no backend or database.
export default defineConfig({
  testDir: './e2e',
  testMatch: /portal-background\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/portal-background',
  use: { ...devices['Desktop Chrome'], hasTouch: true, baseURL: 'http://127.0.0.1:5197', serviceWorkers: 'block' },
  webServer: {
    command: 'npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5197 --strictPort',
    url: 'http://127.0.0.1:5197',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
