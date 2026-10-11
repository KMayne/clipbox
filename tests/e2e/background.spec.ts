import { expect, test, type Page } from '@playwright/test';

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

test('downloads modules in the background on a fast connection', async ({ page }) => {
  test.setTimeout(120_000);
  await fakeConnection(page, { downlink: 10, saveData: false });
  await page.goto('/');
  const settings = await openSettings(page);
  await expect(settings.getByTestId('background-status')).toContainText('all modules downloaded', {
    timeout: 90_000,
  });
  // Every module row shows as available offline, without clicking Download
  const statuses = settings.getByTestId('module-status');
  const n = await statuses.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++) await expect(statuses.nth(i)).toContainText('✓ offline');

  // A manual Remove sticks: background downloads don't fetch it again
  const x509 = settings.getByTestId('module-x509');
  await x509.getByRole('button', { name: 'Remove' }).click();
  await expect(x509.getByRole('button', { name: 'Download' })).toBeVisible();
  await page.reload();
  const again = await openSettings(page);
  await expect(again.getByTestId('background-status')).toContainText('all modules downloaded', {
    timeout: 30_000,
  });
  await expect(again.getByTestId('module-x509').getByTestId('module-status')).not.toContainText(
    '✓ offline',
  );
});

test('pauses when Data Saver is on', async ({ page }) => {
  await fakeConnection(page, { downlink: 10, saveData: true });
  await page.goto('/');
  const settings = await openSettings(page);
  await expect(settings.getByTestId('background-status')).toContainText(
    'paused: Data Saver is on',
    { timeout: 30_000 },
  );
  await expect(settings.getByText('✓ offline')).toHaveCount(0);
});
