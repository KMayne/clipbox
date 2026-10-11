import { expect, test, type Page } from '@playwright/test';

/** Fires a fake `beforeinstallprompt`, as Chromium does once the app is installable. */
async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(e, {
      prompt: async () => {
        Reflect.set(window, '__prompted', true);
      },
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    });
    window.dispatchEvent(e);
  });
}

const openPalette = async (page: Page) => {
  await page.getByRole('button', { name: 'Commands' }).click();
  return page.getByRole('listbox');
};

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('dialog', { name: 'Settings' });
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Install app appears in the palette and Settings only when the browser offers it', async ({
  page,
}) => {
  let palette = await openPalette(page);
  await expect(palette.getByRole('option', { name: 'Install app' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  let settings = await openSettings(page);
  await expect(settings.getByRole('button', { name: 'Install app' })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Close' }).click();

  await offerInstall(page);
  settings = await openSettings(page);
  await expect(settings.getByRole('region', { name: 'App', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Close' }).click();

  palette = await openPalette(page);
  await palette.getByRole('option', { name: 'Install app' }).click();
  expect(await page.evaluate(() => Reflect.get(window, '__prompted'))).toBe(true);
  // A prompt can only be used once
  palette = await openPalette(page);
  await expect(palette.getByRole('option', { name: 'Install app' })).toHaveCount(0);
});

test('Install app goes away once the app is installed', async ({ page }) => {
  await offerInstall(page);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  const palette = await openPalette(page);
  await expect(palette.getByRole('option', { name: 'Install app' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const settings = await openSettings(page);
  await expect(settings.getByRole('region', { name: 'App', exact: true })).toHaveCount(0);
});

test('running as the installed app never offers to install', async ({ page }) => {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = q =>
      q === '(display-mode: standalone)' ? real('(min-width: 0px)') : real(q);
  });
  await page.reload();
  await offerInstall(page);
  const palette = await openPalette(page);
  await expect(palette.getByRole('option', { name: 'Install app' })).toHaveCount(0);
});
