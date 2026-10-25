import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const baseUrl = process.env.KITCHEN_PREVIEW_URL ?? 'http://127.0.0.1:5203';
const outDir = dirname(fileURLToPath(import.meta.url));
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/operacao/cozinha/tv?demo=1&tablet=1`, { waitUntil: 'networkidle' });
  await page.locator('.cozinha-tv-grid > article').first().waitFor();

  const measure = () => page.evaluate(() => {
    const grid = document.querySelector('.cozinha-tv-grid');
    const cards = [...document.querySelectorAll('.cozinha-tv-grid > article')];
    const tops = cards.map((card) => Math.round(card.getBoundingClientRect().top));
    const rows = [...new Set(tops)];
    const firstRowCount = tops.filter((top) => top === tops[0]).length;
    const actions = [...document.querySelectorAll('.cozinha-tv-card-actions button')];
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      grid: { width: Math.round(grid.getBoundingClientRect().width), height: Math.round(grid.getBoundingClientRect().height), clientHeight: grid.clientHeight, scrollHeight: grid.scrollHeight, scrollTop: grid.scrollTop },
      cardCount: cards.length,
      rowCardCounts: rows.map((top) => tops.filter((value) => value === top).length),
      firstRowRects: cards.slice(0, firstRowCount).map(rect),
      actionButtons: { count: actions.length, minHeight: Math.min(...actions.map((button) => button.getBoundingClientRect().height)), maxHeight: Math.max(...actions.map((button) => button.getBoundingClientRect().height)) },
      timerText: document.querySelector('.cozinha-tv-card-timer')?.textContent?.trim() ?? null,
      scrollRange: grid.scrollHeight - grid.clientHeight,
    };
  });

  await page.addStyleTag({ content: `.qt-cozinha-tv { --cozinha-card-min: 15rem !important; --cozinha-card-max: 18rem !important; } .cozinha-tv-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--cozinha-card-min)), var(--cozinha-card-max))) !important; align-items: start !important; } .cozinha-tv-card-actions { margin-top: .2rem !important; }` });
  const before = await measure();
  await page.screenshot({ path: join(outDir, 'before-tablet.png'), fullPage: false });

  await page.locator('style').last().evaluate((el) => el.remove());
  await page.waitForTimeout(150);
  const after = await measure();
  await page.screenshot({ path: join(outDir, 'after-tablet.png'), fullPage: false });
  const timerBefore = after.timerText;
  await page.waitForTimeout(1300);
  const timerAfter = await page.locator('.cozinha-tv-card-timer').first().textContent();

  await page.goto(`${baseUrl}/operacao/cozinha/tv?demo=1`, { waitUntil: 'networkidle' });
  await page.locator('.cozinha-tv-grid > article').nth(29).waitFor();
  const longQueue = await measure();
  await page.locator('.cozinha-tv-grid').evaluate((grid) => { grid.scrollTop = grid.scrollHeight; });
  await page.waitForTimeout(100);
  const bottom = await page.evaluate(() => {
    const grid = document.querySelector('.cozinha-tv-grid');
    const lastCard = grid.lastElementChild;
    const action = lastCard.querySelector('.cozinha-tv-card-actions button');
    const gridRect = grid.getBoundingClientRect();
    const cardRect = lastCard.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    return {
      scrollTop: grid.scrollTop,
      scrollHeight: grid.scrollHeight,
      clientHeight: grid.clientHeight,
      lastCardVisible: cardRect.bottom <= gridRect.bottom && cardRect.top >= gridRect.top,
      lastActionVisible: actionRect.bottom <= gridRect.bottom && actionRect.top >= gridRect.top,
      lastActionHeight: Math.round(actionRect.height),
      lastLabel: lastCard.innerText.split('\n').slice(0, 4),
    };
  });
  await page.screenshot({ path: join(outDir, 'tablet-scroll.png'), fullPage: false });

  const compactPage = await browser.newPage({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 1 });
  await compactPage.goto(`${baseUrl}/operacao/cozinha/tv?demo=1&tablet=1`, { waitUntil: 'networkidle' });
  await compactPage.locator('.cozinha-tv-grid > article').nth(3).waitFor();
  const compact = await compactPage.evaluate(() => {
    const grid = document.querySelector('.cozinha-tv-grid');
    const cards = [...grid.children];
    const tops = cards.map((card) => Math.round(card.getBoundingClientRect().top));
    const buttons = [...grid.querySelectorAll('.cozinha-tv-card-actions button')];
    return {
      viewport: { width: innerWidth, height: innerHeight },
      rowCardCounts: [...new Set(tops)].map((top) => tops.filter((value) => value === top).length),
      cardWidth: Math.round(cards[0].getBoundingClientRect().width),
      grid: { clientHeight: grid.clientHeight, scrollHeight: grid.scrollHeight },
      actionButtonMinHeight: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
      lastActionBottom: Math.round(buttons.at(-1).getBoundingClientRect().bottom),
    };
  });
  await compactPage.screenshot({ path: join(outDir, 'after-tablet-1024x600.png'), fullPage: false });
  await compactPage.close();

  const report = { before, after, compactViewport1024x600: compact, timer: { before: timerBefore, after: timerAfter?.trim(), advanced: timerAfter?.trim() !== timerBefore }, longQueue, bottom };
  await writeFile(join(outDir, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
