import { expect, test } from '@playwright/test';
import { samplePptx } from '../fixtures/pptx';
import { dropBytes, naturalSize, stat } from './helpers';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a dropped .pptx lists its slides, pictures and notes', async ({ page }) => {
  await dropBytes(page, 'review.pptx', PPTX, samplePptx());

  const chip = page.locator('[data-kind=presentation]');
  await expect(chip).toHaveText('PowerPoint · 3 slides · 16:9');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  // The generic zip view is still on offer
  await expect(page.locator('[data-kind=archive]')).toHaveCount(1);

  const slides = page.getByTestId('slide');
  await expect(slides).toHaveCount(3);
  await expect(slides.nth(0)).toContainText('Welcome');
  await expect(slides.nth(0)).toContainText('Q3 results & plans');
  await expect(slides.nth(2)).toContainText('hidden');

  // Thumbnails come from the worker: slide 1 shows image2 (64×64) then image1 (40×30)
  const thumbs = slides.nth(0).getByTestId('slide-image');
  await expect(thumbs).toHaveCount(2);
  expect(await naturalSize(thumbs.nth(0))).toEqual([64, 64]);
  expect(await naturalSize(thumbs.nth(1))).toEqual([40, 30]);

  // Notes start collapsed
  const notes = slides.nth(0).getByText('Say hello');
  await expect(notes).toBeHidden();
  await slides.nth(0).getByText('Notes').click();
  await expect(notes).toBeVisible();

  await page.getByRole('tab', { name: 'stats' }).click();
  await expect(stat(page, 'Author')).toHaveText('Ada Lovelace');
  await expect(stat(page, 'Slide size')).toHaveText('13.33 × 7.5 in (16:9)');
});
