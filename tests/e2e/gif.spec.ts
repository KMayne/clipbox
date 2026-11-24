import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { actionsPane, dropBytes, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** 1 s of 64×48 H.264 + AAC. */
const clip = new Uint8Array(readFileSync(new URL('../fixtures/audio/clip.mp4', import.meta.url)));

test('turns an MP4 into an animated GIF', async ({ page }) => {
  await dropBytes(page, 'clip.mp4', 'video/mp4', clip);
  await expect(page.locator('[data-kind=video]')).toHaveAttribute('aria-pressed', 'true');

  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Video to GIF' }).click();
  const form = pane.getByRole('form', { name: 'Video to GIF settings' });
  await expect(form.getByLabel('Frame rate')).toHaveValue('10');
  await form.getByRole('button', { name: 'Run' }).click();

  const result = page.getByTestId('capture').first();
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 60_000 });
  await expect(result).toContainText('clip.gif');
  await expect(result.getByTestId('derived-from')).toHaveText(/› GIF \(10 fps\)/);
  await expect(result.getByTestId('derived-from')).toContainText('10 frames');
  await expect(result.locator('[data-kind=image]')).toContainText(/GIF.*64×48/);
  await expect(stat(page, 'MIME')).toHaveText('image/gif');
});
