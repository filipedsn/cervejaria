import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Frontend only; every API is intercepted, with unknown requests aborted.
const artifacts = join(process.cwd(), 'artifacts', 'rbac-permissions-ui-2026-10-10');
mkdirSync(artifacts, { recursive: true });
const baseURL = 'http://127.0.0.1:5197';

export default defineConfig({
  testDir: './e2e/current-model',
  testMatch: 'individual-permissions-ui.spec.ts',
  workers: 1,
  retries: 0,
  outputDir: join(artifacts, 'results'),
  reporter: [['list'], ['html', { outputFolder: join(artifacts, 'report'), open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5197 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
