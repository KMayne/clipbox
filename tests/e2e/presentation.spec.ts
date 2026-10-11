import { expect, test } from '@playwright/test';
import { samplePptx } from '../fixtures/pptx';
import { actionsPane, dropBytes, naturalSize, stat } from './helpers';

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

  await expect(stat(page, 'Author')).toHaveText('Ada Lovelace');
  await expect(stat(page, 'Slide size')).toHaveText('13.33 × 7.5 in (16:9)');
});

test('Extract images makes one capture holding every picture', async ({ page }) => {
  await dropBytes(page, 'review.pptx', PPTX, samplePptx());
  await expect(page.locator('[data-kind=presentation]')).toHaveAttribute('aria-pressed', 'true');

  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Extract images' }).click();
  await pane
    .getByRole('form', { name: 'Extract images settings' })
    .getByRole('button', { name: 'Run' })
    .click();

  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('Extract images');
  await expect(derived.locator('[data-kind=image]')).toHaveCount(3);
  await expect(derived).toContainText('slide-01-image1.png');
  await expect(derived).toContainText('unused-image1.png');
});

test('Extract text gives the slides as Markdown', async ({ page }) => {
  await dropBytes(page, 'review.pptx', PPTX, samplePptx());
  await expect(page.locator('[data-kind=presentation]')).toHaveAttribute('aria-pressed', 'true');
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Extract text' }).click();
  await pane
    .getByRole('form', { name: 'Extract text settings' })
    .getByRole('button', { name: 'Run' })
    .click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Text' }).click();
  await expect(page.getByRole('region', { name: 'View' })).toContainText('## Slide 1: Welcome');
});
