import { expect, test } from '@playwright/test';
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

test('turning language detection off skips the model entirely', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', r => {
    if (/model\.json|group1-shard/.test(r.url())) modelRequests.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const row = page.getByTestId('module-langdetect');
  await row.getByRole('radio', { name: 'Off' }).click();
  await expect(row.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  await paste(page, { 'text/plain': TS });
  await expect(page.getByTestId('chip').first()).toHaveText('Text · 4 lines');
  expect(modelRequests).toEqual([]);

  // Policy persists across reloads
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    page.getByTestId('module-langdetect').getByRole('radio', { name: 'Off' }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('with the editor off, text falls back to the plain view', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('clipbox.modules', JSON.stringify({ editor: 'off' })),
  );
  await page.reload();
  await paste(page, { 'text/plain': TS });
  await expect(page.getByTestId('text-view')).toContainText('greet');
  await expect(page.getByTestId('monaco-view')).toHaveCount(0);
});
