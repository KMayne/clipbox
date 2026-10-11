import { expect, test } from '@playwright/test';
import { makePdf, pdfBytes } from '../fixtures/pdf';
import { actionsPane, dropBytes, dropFile, naturalSize } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('PDF Extract images pulls each distinct picture out as PNG', async ({ page }) => {
  const pdf = makePdf({
    pages: [['one'], ['two']],
    images: [
      { width: 50, height: 40, color: [220, 30, 30] },
      { width: 8, height: 8, color: [0, 0, 255] },
      { width: 40, height: 60, color: [128] },
    ],
    // The red image repeats on page 2, like a logo
    pageImages: [
      [0, 1],
      [0, 2],
    ],
  });
  await dropBytes(page, 'deck.pdf', 'application/pdf', pdfBytes(pdf));
  await expect(page.locator('[data-kind=pdf]')).toHaveAttribute('aria-pressed', 'true');

  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Extract images' }).click();
  await pane
    .getByRole('form', { name: 'Extract images settings' })
    .getByRole('button', { name: 'Run' })
    .click();

  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('Extract images');
  const images = derived.locator('[data-kind=image]');
  await expect(images).toHaveCount(2);
  await expect(images.nth(0)).toContainText('50×40');
  await expect(images.nth(1)).toContainText('40×60');
  await expect(derived).toContainText('page-01-image1.png');
  await expect(derived).toContainText('page-02-image1.png');

  // The first one is selected; its pixels are the red the PDF drew
  await expect(images.nth(0)).toHaveAttribute('aria-pressed', 'true');
  const img = page.getByRole('tabpanel').locator('img');
  expect(await naturalSize(img)).toEqual([50, 40]);
  const pixel = await img.evaluate(el => {
    if (!(el instanceof HTMLImageElement)) return [];
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(el, 0, 0);
    return [...ctx.getImageData(10, 10, 1, 1).data];
  });
  expect(pixel).toEqual([220, 30, 30, 255]);
});

test('PDF Extract images says when nothing is found', async ({ page }) => {
  await dropFile(page, 'plain.pdf', 'application/pdf', makePdf({ pages: [['just text']] }));
  await expect(page.locator('[data-kind=pdf]')).toHaveAttribute('aria-pressed', 'true');
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Extract images' }).click();
  await pane
    .getByRole('form', { name: 'Extract images settings' })
    .getByRole('button', { name: 'Run' })
    .click();
  await expect(page.getByText(/Extract images failed: Extract images found nothing/)).toBeVisible();
  await expect(page.getByTestId('capture')).toHaveCount(1);
});
