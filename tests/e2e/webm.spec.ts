import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { actionsPane, dropBytes, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** 1 s of 64×48 H.264 + AAC. */
const clip = new Uint8Array(readFileSync(new URL('../fixtures/audio/clip.mp4', import.meta.url)));

test('converts an MP4 to WebM (VP9 + Opus)', async ({ page }) => {
  await dropBytes(page, 'clip.mp4', 'video/mp4', clip);
  await expect(page.locator('[data-kind=video]')).toHaveAttribute('aria-pressed', 'true');

  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Convert to WebM' }).click();
  const form = pane.getByRole('form', { name: 'Convert to WebM settings' });
  await expect(form.getByLabel('Video codec')).toHaveValue('vp9');
  await form.getByRole('button', { name: 'Run' }).click();

  const result = page.getByTestId('capture').first();
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 60_000 });
  await expect(result).toContainText('clip.webm');
  await expect(result.getByTestId('derived-from')).toHaveText(/› Convert to WebM \(VP9\)$/);
  await expect(result.locator('[data-kind=video]')).toHaveText(/^WebM · 64×48 · 0:01/);
  await expect(stat(page, 'MIME')).toHaveText('video/webm');
});
