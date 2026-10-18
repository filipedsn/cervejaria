import { chromium, type FullConfig } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { personaCredentials, personaStorageState, type PersonaKey } from './personas';

export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.RELEASE_QA_BASE_URL;
  if (!baseURL || !process.env.RELEASE_QA_CONTEXT) throw new Error('Release persona setup requires the disposable API and context file.');
  const stateRoot = path.dirname(personaStorageState('owner'));
  await mkdir(stateRoot, { recursive: true });
  const context = JSON.parse(await readFile(process.env.RELEASE_QA_CONTEXT, 'utf8'));
  const keys: PersonaKey[] = [...Object.keys(context.users), 'admin'];
  const browser = await chromium.launch({ headless: true, ...(process.env.E2E_EXECUTABLE_PATH ? { executablePath: process.env.E2E_EXECUTABLE_PATH } : {}) });
  try {
    for (const key of keys) {
      const browserContext = await browser.newContext({ baseURL, serviceWorkers: 'block' });
      try {
        const page = await browserContext.newPage();
        await page.goto('/login', { waitUntil: 'domcontentloaded' });
        const credentials = personaCredentials(key);
        await page.getByLabel('E-mail').fill(credentials.email);
        await page.locator('#password').fill(credentials.password);
        await page.getByRole('button', { name: 'Entrar' }).click();
        await page.waitForURL((url) => url.pathname !== '/login', { timeout: 10_000 });
        await browserContext.storageState({ path: personaStorageState(key) });
      } finally {
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
}
