import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paste } from './helpers';

const SW_PATH = path.resolve(import.meta.dirname, '../../dist/sw.js');

const TS = [
  'interface User { id: number; name: string }',
  'export function greet(u: User): string {',
  '  return `hi ${u.name}`;',
  '}',
].join('\n');

async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('dialog', { name: 'Settings' });
}

test('downloaded modules work offline; removed ones degrade gracefully', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  const settings = await openSettings(page);
  for (const id of ['langdetect', 'editor']) {
    const row = settings.getByTestId(`module-${id}`);
    await row.getByRole('button', { name: 'Download' }).click();
    await expect(row.getByTestId('module-status')).toContainText('✓ offline', { timeout: 30_000 });
  }
  await page.keyboard.press('Escape');

  await context.setOffline(true);
  await page.reload();
  await paste(page, { 'text/plain': TS });
  await expect(page.getByTestId('chip').first()).toHaveText('TypeScript · 4 lines');
  await expect(page.getByTestId('monaco-view').locator('.monaco-editor')).toBeVisible();

  // Remove language detection; offline, text still parses, just without a language
  const row = (await openSettings(page)).getByTestId('module-langdetect');
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(row.getByRole('button', { name: 'Download' })).toBeVisible();
  await page.reload();
  await paste(page, { 'text/plain': TS });
  await expect(page.getByTestId('chip').first()).toHaveText('Text · 4 lines');
});

test('a new service worker version shows an update notice', async ({ page }) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  // Simulate a deploy: the preview server serves dist/ from disk, so change sw.js in place.
  // (Playwright routing doesn't intercept the browser's own service worker update check.)
  const original = await readFile(SW_PATH, 'utf8');
  try {
    await writeFile(SW_PATH, `${original}\n// next version`);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    await expect(page.getByRole('status')).toContainText('Update available');
    await page.getByRole('button', { name: 'Reload' }).click();
    await page.waitForLoadState('load');
    await expect(page.getByRole('status')).toHaveCount(0);
  } finally {
    await writeFile(SW_PATH, original);
  }
});
