import { expect, test } from '@playwright/test';
import { makePdf, samplePdf } from '../fixtures/pdf';
import { actionsPane, dropFile, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('dropped PDF renders pages and extracts text as a derived capture', async ({ page }) => {
  await dropFile(page, 'sample.pdf', 'application/pdf', samplePdf());

  const chip = page.locator('[data-kind=pdf]');
  await expect(chip).toHaveText('PDF · 2 pages · A4');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  // A page image renders in the worker and shows up with real pixels
  const img = page.getByTestId('pdf-page').first();
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate(el => (el instanceof HTMLImageElement ? el.naturalWidth : 0)))
    .toBeGreaterThan(100);
  // The page is mostly white with some dark text pixels
  const dark = await img.evaluate(el => {
    if (!(el instanceof HTMLImageElement)) return 0;
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(el, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 128) n++;
    return n;
  });
  expect(dark).toBeGreaterThan(50);
  await expect(page.getByTestId('pdf-page-counter')).toHaveText('Page 1 / 2');

  await page.getByRole('button', { name: '2×' }).click();
  await expect(page.getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Go to page').fill('2');
  await page.getByLabel('Go to page').press('Enter');
  await expect(page.getByTestId('pdf-page-counter')).toHaveText('Page 2 / 2');

  await page.getByRole('tab', { name: 'stats' }).click();
  await expect(stat(page, 'Title')).toHaveText('Clipbox sample');
  await expect(stat(page, 'Author')).toHaveText('Ada Lovelace');
  await expect(stat(page, 'Page size')).toHaveText('A4');
  await expect(stat(page, 'Section 1.1')).toHaveText('p. 1');
  await page.getByRole('tab', { name: 'preview' }).click();

  await actionsPane(page).getByRole('button', { name: 'Extract text' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toHaveText(
    'from PDF · 2 pages · A4 › Extract text',
  );
  await expect(derived.locator('[data-kind=text]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Hello from page one');
});

test('encrypted PDF shows an error instead of crashing', async ({ page }) => {
  await dropFile(
    page,
    'secret.pdf',
    'application/pdf',
    makePdf({ pages: [['x']], encrypted: true }),
  );
  await expect(page.locator('[data-kind=pdf]')).toHaveText('PDF · encrypted');
  await expect(page.getByTestId('pdf-error')).toHaveText('Encrypted: a password is required');
});
