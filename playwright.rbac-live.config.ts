import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const baseURL = process.env.RBAC_QA_BASE_URL;
if (!baseURL) throw new Error('RBAC_QA_BASE_URL must point to the disposable Vite server.');
const outputDir = join(process.cwd(), 'artifacts', 'rbac-permissions-ui-2026-10-10', 'live-results');
mkdirSync(outputDir, { recursive: true });

export default defineConfig({
  testDir: './e2e/rbac-live',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  outputDir,
  reporter: [['list'], ['json', { outputFile: join(outputDir, 'playwright-results.json') }]],
  use: { ...devices['Desktop Chrome'], baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
