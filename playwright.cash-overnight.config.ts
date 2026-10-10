import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5199';

export default defineConfig({
  testDir: './e2e/current-model',
  testMatch: 'cash-overnight-ui.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'artifacts/cash-overnight-ui/results',
  use: { ...devices['Desktop Chrome'], baseURL, serviceWorkers: 'block' },
  webServer: {
    command: 'npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5199 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
