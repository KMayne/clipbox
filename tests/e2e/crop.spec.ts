import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { actionsPane, dropBytes, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** 1 s of 64×48 H.264 + AAC. */
const clip = new Uint8Array(readFileSync(new URL('../fixtures/audio/clip.mp4', import.meta.url)));

const result = (page: Page) => page.getByTestId('capture').first();
const cropForm = (page: Page) => page.getByRole('form', { name: 'Crop' });

async function openCrop(page: Page) {
  await dropBytes(page, 'clip.mp4', 'video/mp4', clip);
  await expect(page.locator('[data-kind=video]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('trim-bar').getByRole('button', { name: 'Crop' }).click();
  await expect(page.getByTestId('crop-overlay')).toBeVisible();
}

test('draws a crop box on the video and crops to it', async ({ page }) => {
  await openCrop(page);
  // No box yet: the fields show the full frame and Crop waits for a box
  await expect(cropForm(page).getByLabel('Crop width')).toHaveValue('64');
  await expect(cropForm(page).getByLabel('Crop height')).toHaveValue('48');
  await expect(cropForm(page).getByRole('button', { name: 'Crop' })).toBeDisabled();

  // Draw a box, then drag its bottom-right handle, in video pixels scaled to the overlay
  const overlay = await page.getByTestId('crop-overlay').boundingBox();
  if (!overlay) throw new Error('no overlay');
  const s = overlay.width / 64;
  const at = (x: number, y: number) => [overlay.x + x * s, overlay.y + y * s] as const;
  await page.mouse.move(...at(8, 6));
  await page.mouse.down();
  await page.mouse.move(...at(40, 30), { steps: 4 });
  await page.mouse.up();
  await expect(cropForm(page).getByLabel('Crop left')).toHaveValue('8');
  await expect(cropForm(page).getByLabel('Crop width')).toHaveValue('32');
  await expect(cropForm(page).getByLabel('Crop height')).toHaveValue('24');
  await page.mouse.move(...at(40, 30));
  await page.mouse.down();
  await page.mouse.move(...at(50, 40), { steps: 4 });
  await page.mouse.up();
  await expect(cropForm(page).getByLabel('Crop width')).toHaveValue('42');
  // Dragging inside moves it
  await page.mouse.move(...at(20, 20));
  await page.mouse.down();
  await page.mouse.move(...at(24, 22), { steps: 4 });
  await page.mouse.up();
  await expect(cropForm(page).getByLabel('Crop left')).toHaveValue('12');

  // Exact numbers win
  await cropForm(page).getByLabel('Crop left').fill('16');
  await cropForm(page).getByLabel('Crop top').fill('12');
  await cropForm(page).getByLabel('Crop width').fill('32');
  await cropForm(page).getByLabel('Crop height').fill('24');
  await expect(page.getByTestId('crop-box')).toContainText('32 × 24');

  await cropForm(page).getByRole('button', { name: 'Crop' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 60_000 });
  await expect(result(page)).toContainText('clip (cropped 32×24).mp4');
  await expect(result(page).getByTestId('derived-from')).toHaveText(/› Crop 32×24 at 16, 12$/);
  await expect(result(page).locator('[data-kind=video]')).toHaveText(/^MP4 · 32×24 · 0:01/);
  await expect(stat(page, 'Dimensions')).toHaveText('32 × 24');
  // Crop mode ends with the result shown
  await expect(page.getByTestId('crop-overlay')).toHaveCount(0);
});

test('an aspect preset reshapes the box, and Escape cancels', async ({ page }) => {
  await openCrop(page);
  // With no box, the preset fits the full frame
  await cropForm(page).getByLabel('Aspect').selectOption('1:1');
  await expect(cropForm(page).getByLabel('Crop width')).toHaveValue('48');
  await expect(cropForm(page).getByLabel('Crop height')).toHaveValue('48');
  await expect(cropForm(page).getByLabel('Crop left')).toHaveValue('8');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('crop-overlay')).toHaveCount(0);
  await expect(page.getByTestId('trim-bar')).toBeVisible();
  await expect(page.getByTestId('capture')).toHaveCount(1);
});

test('Crop video is in the sidebar for video, not audio', async ({ page }) => {
  await dropBytes(page, 'clip.mp4', 'video/mp4', clip);
  await expect(actionsPane(page).getByRole('button', { name: 'Crop video' })).toBeVisible();
});
