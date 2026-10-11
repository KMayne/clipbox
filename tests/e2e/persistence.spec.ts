import { expect, test, type Page } from '@playwright/test';
import { paste, savedCount } from './helpers';

const JSON_TEXT = JSON.stringify([
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Linus' },
]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function pasteAndSave(page: Page) {
  await paste(page, { 'text/plain': JSON_TEXT });
  await expect(page.getByTestId('chip').first()).toHaveText('JSON array · 2');
  await expect.poll(() => savedCount(page)).toBe(1);
}

test('pastes survive a reload', async ({ page }) => {
  await pasteAndSave(page);
  await page.reload();

  await expect(page.getByTestId('capture')).toHaveCount(1);
  await expect(page.getByTestId('capture')).toContainText('paste');
  await expect(page.getByTestId('chip')).toHaveText(['JSON array · 2', 'Records 2×2', /^JSON/]);
  await expect(page.getByTestId('json-tree')).toBeVisible();
});

test('removed pastes stay gone after a reload', async ({ page }) => {
  await pasteAndSave(page);
  const capture = page.getByTestId('capture');
  await capture.getByText('paste · 1 format').hover(); // Remove shows on header hover
  await capture.getByTitle('Remove').click();
  await expect(capture).toHaveCount(0);
  await expect.poll(() => savedCount(page)).toBe(0);

  await page.reload();
  await expect(page.getByText('Paste (Ctrl+V) or drop a file to start')).toBeVisible();
  await expect(page.getByTestId('capture')).toHaveCount(0);
});

test('turning off Keep history deletes saved pastes', async ({ page }) => {
  await pasteAndSave(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  const history = page.getByRole('region', { name: 'History' });
  await expect(history).toContainText('Stored on this device only');
  await expect(history.getByRole('radio', { name: '7 days' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await history.getByLabel('Keep history').click(); // stays checked until confirmed
  await history.getByRole('button', { name: 'Turn off' }).click();
  await expect(history.getByLabel('Keep history')).not.toBeChecked();
  await expect.poll(() => savedCount(page)).toBe(0);
  await page.keyboard.press('Escape');

  // New pastes aren't saved either
  await paste(page, { 'text/plain': 'not saved' });
  await expect(page.getByTestId('capture')).toHaveCount(2);

  await page.reload();
  await expect(page.getByText('Paste (Ctrl+V) or drop a file to start')).toBeVisible();
  await expect(page.getByTestId('capture')).toHaveCount(0);
  expect(await savedCount(page)).toBe(0);
});

test('Clear all data wipes memory and storage', async ({ page }) => {
  await pasteAndSave(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const history = page.getByRole('region', { name: 'History' });
  await history.getByRole('button', { name: 'Clear all data' }).click();
  await history.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => savedCount(page)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('capture')).toHaveCount(0);
});
