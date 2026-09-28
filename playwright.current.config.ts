import { defineConfig, devices } from '@playwright/test';
import { assertTestProdWriteGuard } from './scripts/test-prod-write-guard.mjs';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5202';
const apiBase = process.env.E2E_API_BASE ?? 'http://localhost:3002';
assertTestProdWriteGuard({ apiBase, context: 'current-model E2E runner' });

export default defineConfig({
  testDir: './e2e/current-model',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-current', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.E2E_EXECUTABLE_PATH
      ? { executablePath: process.env.E2E_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: process.env.E2E_SKIP_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: `${apiBase}/api/health`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
