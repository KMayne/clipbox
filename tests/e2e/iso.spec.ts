import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { gunzipSync } from 'fflate';
import { dropBytes } from './helpers';

/** The gzipped fixtures from tests/fixtures/iso/make.py. */
const fixture = (name: string) =>
  gunzipSync(new Uint8Array(readFileSync(new URL(`../fixtures/iso/${name}`, import.meta.url))));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('an ISO 9660 image lists its Joliet tree and opens a file', async ({ page }) => {
  await dropBytes(page, 'disc.iso', 'application/x-iso9660-image', fixture('iso9660.iso.gz'));
  await expect(page.locator('[data-kind=archive]')).toHaveText(
    'ISO 9660 · CLIPBOX_DISC · 2 files · 61 B',
  );
  const table = page.getByTestId('archive-table');
  await expect(table.getByTestId('archive-row')).toHaveCount(3);
  await expect(table).toContainText('docs/data.json');
  await expect(table).toContainText('readme.txt');
  await expect(page.getByRole('region', { name: 'Info' })).toContainText('ISO 9660 with Joliet');

  await table.getByRole('button', { name: 'Open docs/data.json' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('docs/data.json');
  await expect(derived.locator('[data-kind=json]')).toHaveText('JSON object · 2 keys');
  await expect(page.getByTestId('json-tree')).toContainText('iso9660');
});

test('a UDF image lists long names and opens a file', async ({ page }) => {
  await dropBytes(page, 'udf.iso', 'application/x-iso9660-image', fixture('udf.iso.gz'));
  await expect(page.locator('[data-kind=archive]')).toHaveText(
    'UDF · CLIPBOX_UDF · 2 files · 66 B',
  );
  const table = page.getByTestId('archive-table');
  await expect(table.getByTestId('archive-row')).toHaveCount(3);
  await table.getByRole('button', { name: 'Open notes/Read Me First.md' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('Read Me First.md');
  await expect(derived.locator('[data-kind=markdown]')).toBeVisible();
});
