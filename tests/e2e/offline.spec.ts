import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { paste } from './helpers';

const SW_PATH = path.resolve(import.meta.dirname, '../../dist/sw.js');
const MANIFEST_PATH = path.resolve(import.meta.dirname, '../../dist/modules-manifest.json');

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

/** Deletes a module's cache behind the app's back, as if the browser evicted it. */
async function evictModule(page: Page, id: string) {
  const deleted = await page.evaluate(async id => {
    const names = (await caches.keys()).filter(n => n.startsWith(`clipbox-mod-${id}-`));
    await Promise.all(names.map(n => caches.delete(n)));
    return names.length;
  }, id);
  expect(deleted).toBe(1);
}

test('with Everything now, the app works offline; evicted modules degrade gracefully and Repair restores them', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  // On demand first, so nothing downloads until the mode changes
  await page.addInitScript(() => {
    if (!localStorage.getItem('clipbox.moduleDownloads'))
      localStorage.setItem('clipbox.moduleDownloads', JSON.stringify({ mode: 'onDemand' }));
  });
  await page.goto('/');
  await waitForServiceWorker(page);

  let settings = await openSettings(page);
  await settings.getByRole('radio', { name: 'Everything now' }).check();
  await expect(settings.getByTestId('background-status')).toHaveText('All modules downloaded', {
    timeout: 90_000,
  });
  await page.keyboard.press('Escape');

  await context.setOffline(true);
  await page.reload();
  await paste(page, { 'text/plain': TS });
  await expect(page.getByTestId('chip').first()).toHaveText('TypeScript · 4 lines');
  await expect(page.getByTestId('monaco-view').locator('.monaco-editor')).toBeVisible();

  // jq runs in a runner worker nested in the engine worker: it and its wasm come from the cache
  await paste(page, { 'text/plain': '[1, 2, 3]' });
  const pane = page.getByRole('region', { name: 'Actions' });
  await pane.getByRole('button', { name: 'jq', exact: true }).click();
  const form = pane.getByRole('form', { name: 'jq settings' });
  await form.getByLabel('Filter').fill('map(. * 2) | add');
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(3);
  await expect(page.getByTestId('capture').first().getByTestId('derived-from')).toContainText(
    'jq map(. * 2) | add',
  );

  // Language detection evicted while offline: text still parses, just without a language
  await evictModule(page, 'langdetect');
  await page.reload();
  await paste(page, { 'text/plain': TS });
  await expect(page.getByTestId('chip').first()).toHaveText('Text · 4 lines');

  // Back online, Repair downloads it again
  await context.setOffline(false);
  settings = await openSettings(page);
  const status = settings.getByTestId('module-langdetect').getByTestId('module-status');
  await expect(status).toHaveText('not downloaded');
  await settings.getByRole('button', { name: 'Repair offline cache' }).click();
  const confirm = settings.getByRole('alert');
  await expect(confirm).toContainText('Delete the offline cache and download it again?');
  await confirm.getByRole('button', { name: 'Repair' }).click();
  await expect(settings.getByTestId('update-status')).toHaveText('Offline cache repaired', {
    timeout: 60_000,
  });
  await expect(status).toHaveText('available offline');
  await expect(settings.getByTestId('module-pdf').getByTestId('module-status')).toHaveText(
    'available offline',
  );
});

test('Repair can be cancelled', async ({ page }) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Repair offline cache' }).click();
  await settings.getByRole('alert').getByRole('button', { name: 'Cancel' }).click();
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await expect(settings.getByTestId('update-status')).toHaveText('');
});

test('the footer shows the build version and date', async ({ page }) => {
  const manifest = z
    .object({ version: z.string() })
    .parse(JSON.parse(await readFile(MANIFEST_PATH, 'utf8')));
  await page.goto('/');
  const settings = await openSettings(page);
  const version = settings.getByTestId('app-version');
  await expect(version).toContainText(`Version ${manifest.version} · built `);
  await expect(version).toContainText(String(new Date().getFullYear()));
});

test('Check for updates says up to date, then finds a new version', async ({ page }) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  const settings = await openSettings(page);
  const check = settings.getByRole('button', { name: 'Check for updates' });
  await check.click();
  await expect(settings.getByTestId('update-status')).toHaveText('Up to date');

  // Simulate a deploy: the preview server serves dist/ from disk, so change sw.js in place.
  // (Playwright routing doesn't intercept the browser's own service worker update check.)
  const original = await readFile(SW_PATH, 'utf8');
  try {
    await writeFile(SW_PATH, `${original}\n// next version`);
    await check.click();
    await expect(settings.getByTestId('update-status')).toHaveText('Update found, installing…');
    await expect(page.getByRole('status')).toContainText('Update available');
    await page.getByRole('button', { name: 'Reload' }).click();
    await page.waitForLoadState('load');
    await expect(page.getByRole('status')).toHaveCount(0);
  } finally {
    await writeFile(SW_PATH, original);
  }
});
