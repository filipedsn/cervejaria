import { defineConfig, devices } from '@playwright/test';
import { assertTestProdWriteGuard } from './scripts/test-prod-write-guard.mjs';

const baseURL = 'http://127.0.0.1:5196';
assertTestProdWriteGuard({ apiBase: baseURL, context: 'agenda layout mocked API tests' });

export default defineConfig({
  testDir: './e2e',
  testMatch: ['agenda-operacional.spec.ts', 'agenda-calendario.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL, serviceWorkers: 'block' },
  webServer: {
    command: 'npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5196 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
