import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { dropBytes } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('zip entries open as derived captures', async ({ page }) => {
  const zip = zipSync({
    'data.json': strToU8('{"user":"ada","roles":["admin"]}'),
    'notes.txt': strToU8('hello from the zip'),
  });
  await dropBytes(page, 'bundle.zip', 'application/zip', zip);

  const chip = page.locator('[data-kind=archive]');
  await expect(chip).toHaveText('ZIP · 2 files · 50 B');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const table = page.getByTestId('archive-table');
  await expect(table.getByTestId('archive-row')).toHaveCount(2);
  await expect(table).toContainText('notes.txt');

  await table.getByRole('button', { name: 'Open data.json' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('data.json');
  await expect(derived.locator('[data-kind=json]')).toHaveText('JSON object · 2 keys');
  await expect(page.getByTestId('json-tree')).toContainText('user');
});

test('the libarchive module lists a tar.xz', async ({ page }) => {
  const bytes = readFileSync(new URL('../fixtures/archives/sample.tar.xz', import.meta.url));
  await dropBytes(page, 'sample.tar.xz', 'application/x-xz', bytes);
  await expect(page.locator('[data-kind=archive]')).toHaveText('TAR.XZ · 2 files · 14 B');
  const table = page.getByTestId('archive-table');
  await expect(table.getByTestId('archive-row')).toHaveCount(2);
  await expect(table).toContainText('data.json');
  await table.getByRole('button', { name: 'Open notes.txt' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
});
