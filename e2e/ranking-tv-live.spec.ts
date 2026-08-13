import { expect, test } from '@playwright/test';
import path from 'node:path';
import { loadArenaFixture } from './helpers/fixtures';

const arenaAuth = path.join(process.cwd(), 'e2e/.auth/arena.json');

test.use({ storageState: arenaAuth });

test.describe('Modo TV ao vivo', () => {
  test('dono autenticado abre ranking TV do evento arena', async ({ page }) => {
    const arena = await loadArenaFixture();
    test.skip(!arena, 'Requer npm run qa:setup (arena qa-arena com evento aberto)');

    await page.goto(`/ranking/tv/${arena!.eventoId}`);

    await expect(page).toHaveURL(new RegExp(`/ranking/tv/${arena!.eventoId}`));
    await expect(page.getByText('Ranking ao vivo')).toBeVisible();
    await expect(page.getByText('Arena de Concorrência')).toBeVisible();
  });
});
