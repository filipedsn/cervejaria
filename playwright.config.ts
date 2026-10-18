import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { assertTestProdWriteGuard } from './scripts/test-prod-write-guard.mjs';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5202';
assertTestProdWriteGuard({ apiBase: baseURL, context: 'E2E runner' });
const authDir = path.join(process.cwd(), 'e2e/.auth');

export default defineConfig({
  testDir: './e2e',
  // The full regression creates and changes shared QA fixtures (including
  // operational capabilities). Run it serially so the official command is
  // deterministic; dedicated QA suites retain their own concurrency coverage.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: process.env.E2E_CAPTURE_SMOKE === '1' ? 'on' : 'only-on-failure',
    ...(process.env.E2E_VIEWPORT_WIDTH
      ? { viewport: { width: Number(process.env.E2E_VIEWPORT_WIDTH), height: 900 } }
      : {}),
    launchOptions: process.env.E2E_EXECUTABLE_PATH
      ? { executablePath: process.env.E2E_EXECUTABLE_PATH }
      : undefined,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, timeout: 120_000 },
    {
      name: 'chromium-pwa',
      dependencies: ['setup'],
      testMatch: /pwa-offline\.spec\.ts/,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts/, /pwa-offline\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.E2E_VIEWPORT_WIDTH
          ? { viewport: { width: Number(process.env.E2E_VIEWPORT_WIDTH), height: 900 } }
          : {}),
      },
    },
  ],
  webServer: process.env.E2E_SKIP_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://127.0.0.1:3002/api/health',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
