import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const MANIFEST_PATH = path.resolve(import.meta.dirname, '../../dist/modules-manifest.json');

/** Fakes Chrome's Network Information API before the app loads. */
async function fakeConnection(page: Page, info: { downlink: number; saveData: boolean }) {
  await page.addInitScript(info => {
    const conn = Object.assign(new EventTarget(), { effectiveType: '4g', ...info });
    Object.defineProperty(navigator, 'connection', { get: () => conn });
  }, info);
}

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('dialog', { name: 'Settings' });
};

/** Every module row says it's available offline. */
async function expectAllOffline(settings: Locator) {
  const statuses = settings.getByTestId('module-status');
  const n = await statuses.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++) await expect(statuses.nth(i)).toContainText('available offline');
}

test('Automatic downloads modules in the background on a fast connection', async ({ page }) => {
  test.setTimeout(120_000);
  await fakeConnection(page, { downlink: 10, saveData: false });
  await page.goto('/');
  const settings = await openSettings(page);
  await expect(settings.getByRole('radio', { name: 'Automatic' })).toBeChecked();
  await expect(settings.getByTestId('background-status')).toHaveText('All modules downloaded', {
    timeout: 90_000,
  });
  await expectAllOffline(settings);

  // Rows show the library version from the build manifest
  const manifest = z
    .object({ modules: z.record(z.string(), z.object({ version: z.string() })) })
    .parse(JSON.parse(await readFile(MANIFEST_PATH, 'utf8')));
  const pdf = manifest.modules.pdf?.version;
  expect(pdf).toMatch(/^\d+\.\d+\.\d+/);
  await expect(settings.getByTestId('module-pdf').getByTestId('module-library')).toHaveText(
    `pdf.js ${pdf}`,
  );
});

test('Automatic pauses when Data Saver is on', async ({ page }) => {
  await fakeConnection(page, { downlink: 10, saveData: true });
  await page.goto('/');
  const settings = await openSettings(page);
  await expect(settings.getByTestId('background-status')).toHaveText(
    'Background downloads paused: Data Saver is on',
    { timeout: 30_000 },
  );
  await expect(settings.getByText('available offline')).toHaveCount(0);
});

test('On demand downloads nothing in the background, even on a fast connection', async ({
  page,
}) => {
  await fakeConnection(page, { downlink: 10, saveData: false });
  await page.addInitScript(() =>
    localStorage.setItem('clipbox.moduleDownloads', JSON.stringify({ mode: 'onDemand' })),
  );
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const settings = await openSettings(page);
  await expect(settings.getByRole('radio', { name: 'On demand' })).toBeChecked();
  await expect(settings.getByTestId('background-status')).toHaveText('No background downloads');
  await expect(settings.getByTestId('module-x509').getByTestId('module-status')).toHaveText(
    'not downloaded',
  );
  await expect(settings.getByText('available offline')).toHaveCount(0);
});

test('Everything now downloads every module, even on a slow connection', async ({ page }) => {
  test.setTimeout(120_000);
  await fakeConnection(page, { downlink: 1, saveData: true });
  await page.goto('/');
  const settings = await openSettings(page);
  await expect(settings.getByTestId('background-status')).toContainText('paused', {
    timeout: 30_000,
  });
  await settings.getByRole('radio', { name: 'Everything now' }).check();
  await expect(settings.getByTestId('background-status')).toHaveText('All modules downloaded', {
    timeout: 90_000,
  });
  await expectAllOffline(settings);
});
