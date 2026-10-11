import { expect, test, type Page } from '@playwright/test';
import { paste } from './helpers';

const TS = [
  'interface User { id: number; name: string }',
  'export function greet(u: User): string {',
  '  return `hi ${u.name}`;',
  '}',
].join('\n');

test('detects the language of pasted code and shows it in Monaco', async ({ page }) => {
  await page.goto('/');
  await paste(page, { 'text/plain': TS });
  await expect(page.getByTestId('chip').first()).toHaveText('TypeScript · 4 lines');
  const editor = page.getByTestId('monaco-view');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await expect(editor).toContainText('greet');
  // Monaco tokenised it as TypeScript: keywords get a token class
  await expect(editor.locator('.view-line span[class*="mtk"]').first()).toBeVisible();

  await page.keyboard.press('2');
  await expect(page.getByTestId('stats')).toContainText('TypeScript (');
});

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('dialog', { name: 'Settings' });
};

test('module rows show status only: library, size and state, with no per-module controls', async ({
  page,
}) => {
  await page.goto('/');
  await paste(page, { 'text/plain': TS });
  await expect(page.getByTestId('chip').first()).toHaveText('TypeScript · 4 lines');

  const settings = await openSettings(page);
  const pdf = settings.getByTestId('module-pdf');
  // No build manifest in dev, so the library has no version
  await expect(pdf.getByTestId('module-library')).toHaveText('pdf.js');
  await expect(pdf.getByTestId('module-status')).toHaveText('not loaded');
  await expect(settings.getByTestId('module-sheets').getByTestId('module-library')).toHaveText(
    'SheetJS',
  );
  await expect(settings.getByTestId('module-langdetect').getByTestId('module-status')).toHaveText(
    'loaded',
  );
  await expect(settings.getByTestId('module-editor').getByTestId('module-status')).toHaveText(
    'loaded',
  );

  const table = settings.getByRole('table');
  await expect(table.getByRole('button')).toHaveCount(0);
  await expect(table.getByRole('radio')).toHaveCount(0);

  // No service worker in dev: no version, update check or repair
  await expect(settings.getByTestId('app-version')).toHaveText('Development build');
  await expect(settings.getByRole('button', { name: 'Check for updates' })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Repair offline cache' })).toHaveCount(0);
});

test('the Module downloads setting defaults to Automatic and persists', async ({ page }) => {
  await page.goto('/');
  let settings = await openSettings(page);
  const group = settings.getByRole('radiogroup', { name: 'Module downloads' });
  await expect(group.getByRole('radio', { name: 'Automatic' })).toBeChecked();
  await expect(group.getByRole('radio', { name: 'On demand' })).toHaveAccessibleDescription(
    /metered/,
  );
  await expect(settings.getByTestId('background-status')).toContainText('production builds');

  await group.getByRole('radio', { name: 'Everything now' }).check();
  expect(await page.evaluate(() => localStorage.getItem('clipbox.moduleDownloads'))).toBe(
    '{"mode":"everything"}',
  );
  await page.reload();
  settings = await openSettings(page);
  await expect(settings.getByRole('radio', { name: 'Everything now' })).toBeChecked();
});

test('migrates a disabled background-download toggle to On demand', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'clipbox.backgroundDownloads',
      JSON.stringify({ enabled: false, skipped: ['x509'] }),
    );
    localStorage.setItem('clipbox.modules', JSON.stringify({ editor: 'off' }));
  });
  await page.reload();
  const settings = await openSettings(page);
  await expect(settings.getByRole('radio', { name: 'On demand' })).toBeChecked();
  expect(
    await page.evaluate(() => ({
      mode: localStorage.getItem('clipbox.moduleDownloads'),
      background: localStorage.getItem('clipbox.backgroundDownloads'),
      policies: localStorage.getItem('clipbox.modules'),
    })),
  ).toEqual({ mode: '{"mode":"onDemand"}', background: null, policies: null });

  // The old editor: 'off' no longer applies
  await page.keyboard.press('Escape');
  await paste(page, { 'text/plain': TS });
  await expect(page.getByTestId('monaco-view').locator('.monaco-editor')).toBeVisible();
});
