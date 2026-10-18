import { defineConfig, devices } from '@playwright/test';
import { assertTestProdWriteGuard } from './scripts/test-prod-write-guard.mjs';

const baseURL = process.env.RELEASE_QA_BASE_URL;
const releaseSha = process.env.RELEASE_SHA;
if (!baseURL) throw new Error('RELEASE_QA_BASE_URL must point at the disposable release QA API.');
if (!releaseSha || !/^[a-f0-9]{7,40}$/i.test(releaseSha)) throw new Error('RELEASE_SHA must identify the tested commit.');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) throw new Error('Release QA API must bind to 127.0.0.1.');
if (process.env.PDV_ISOLATED_QA !== '1') throw new Error('Release E2E requires PDV_ISOLATED_QA=1.');
assertTestProdWriteGuard({ apiBase: baseURL, context: 'release E2E runner' });

export default defineConfig({
  globalSetup: './e2e/release/support/global-setup.ts',
  testDir: './e2e/release',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: `artifacts/release-e2e/${releaseSha}/playwright-results.json` }]],
  outputDir: `artifacts/release-e2e/${releaseSha}/test-results`,
  use: { baseURL, serviceWorkers: 'block', trace: 'on', screenshot: 'on', video: 'on' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 820 } } },
    { name: 'tv', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
  ],
});
