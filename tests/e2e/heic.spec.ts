import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actionsPane, dropBytes, naturalSize, stat } from './helpers';

// Built by tests/fixtures/heic/make.py (x265 frames in a minimal HEIF container)
const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/heic/${name}`, import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const view = (page: Page) => page.getByRole('region', { name: 'View' }).locator('img');

/** RGBA of one pixel of a decoded <img>. */
const pixel = (img: Locator, x: number, y: number) =>
  img.evaluate(
    (el, [x, y]) => {
      if (!(el instanceof HTMLImageElement)) return [];
      const c = document.createElement('canvas');
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(el, 0, 0);
      return [...ctx.getImageData(x ?? 0, y ?? 0, 1, 1).data];
    },
    [x, y],
  );

const near = (got: number[], want: number[], tolerance = 12) =>
  expect(
    got.every((v, i) => Math.abs(v - (want[i] ?? 0)) <= tolerance),
    `${got} ≈ ${want}`,
  ).toBe(true);

test('a HEIC photo previews as an image and converts to PNG', async ({ page }) => {
  await dropBytes(page, 'IMG_0001.HEIC', 'image/heic', fixture('halves.heic'));
  const chip = page.locator('[data-kind=image]');
  await expect(chip).toHaveText(/HEIC 64×48/);
  await expect(chip).not.toHaveText(/pages?/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(stat(page, 'Format')).toHaveText('HEIC');
  await expect(stat(page, 'MIME')).toHaveText('image/heic');
  await expect(stat(page, 'Bit depth')).toHaveText('8-bit');

  const img = view(page);
  expect(await naturalSize(img)).toEqual([64, 48]);
  near(await pixel(img, 2, 2), [220, 20, 30, 255]);
  near(await pixel(img, 60, 40), [10, 40, 230, 255]);

  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Convert', exact: true }).click();
  const form = pane.getByRole('form', { name: 'Convert settings' });
  await form.getByLabel('Format').selectOption('png');
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const converted = page.getByTestId('capture').first();
  await expect(converted.locator('[data-kind=image]')).toHaveText(/PNG 64×48/);
  await expect(converted).toContainText('IMG_0001.png');
  expect(await naturalSize(view(page))).toEqual([64, 48]);
  near(await pixel(view(page), 60, 40), [10, 40, 230, 255]);
});

test('a multi-image HEIC shows each image as a page', async ({ page }) => {
  await dropBytes(page, 'burst.heic', 'image/heic', fixture('burst.heic'));
  const chip = page.locator('[data-kind=image]');
  await expect(chip).toHaveText(/HEIC 64×48 · 3 pages/);
  await expect(stat(page, 'Images')).toHaveText('3');

  const img = view(page);
  expect(await naturalSize(img)).toEqual([64, 48]);
  near(await pixel(img, 1, 1), [220, 20, 30, 255]);

  const pager = page.getByTestId('image-pages');
  await expect(pager).toContainText('Page 1 / 3');
  await pager.getByRole('button', { name: 'Next page' }).click();
  await expect(pager).toContainText('Page 2 / 3');
  await expect.poll(async () => (await naturalSize(img)).join()).toBe('32,32');
  near(await pixel(img, 5, 5), [20, 200, 40, 255]);
  await pager.getByRole('button', { name: 'Next page' }).click();
  await expect.poll(async () => (await naturalSize(img)).join()).toBe('16,24');
  near(await pixel(img, 8, 12), [10, 40, 230, 255]);

  await actionsPane(page).getByRole('button', { name: 'Pages as PNG' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.locator('[data-kind=image]')).toHaveCount(3);
  await expect(derived).toContainText('burst-page03.png');
});

test('a broken HEIC reports an error instead of an image', async ({ page }) => {
  // A real ftyp box, then garbage: detected as HEIC, then libheif rejects it
  const bytes = new Uint8Array(fixture('halves.heic').subarray(0, 120));
  await dropBytes(page, 'broken.heic', 'image/heic', bytes);
  await expect(page.getByText(/Not a readable HEIF file/).first()).toBeVisible();
});
