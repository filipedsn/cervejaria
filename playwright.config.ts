import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5202';
const authDir = path.join(process.cwd(), 'e2e/.auth');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
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
      use: { ...devices['Desktop Chrome'] },
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
