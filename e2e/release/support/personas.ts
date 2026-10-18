import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext } from '@playwright/test';

export type PersonaKey = 'owner' | 'ownerB' | 'cashier' | 'kitchen' | 'staffB' | 'admin';
const context = JSON.parse(readFileSync(process.env.RELEASE_QA_CONTEXT!, 'utf8')) as {
  users: Record<string, { email: string; password: string }>;
  admin: { email: string; password: string };
};
const stateRoot = path.join(process.cwd(), 'artifacts', 'release-e2e', process.env.RELEASE_SHA!, 'personas');

export function personaCredentials(key: PersonaKey) {
  return key === 'admin' ? context.admin : context.users[key];
}

export function personaStorageState(key: PersonaKey) {
  return path.join(stateRoot, `${key}.json`);
}

export async function personaContext(browser: Browser, baseURL: string, key: PersonaKey): Promise<BrowserContext> {
  return browser.newContext({ baseURL, storageState: personaStorageState(key), serviceWorkers: 'block' });
}
