import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { wav } from '../fixtures/media';
import { actionsPane, dropBytes } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/audio/${name}`, import.meta.url)));

const result = (page: Page) => page.getByTestId('capture').first();
const derivedFrom = (page: Page) => result(page).getByTestId('derived-from');
const trimForm = (page: Page) => page.getByRole('form', { name: 'Trim' });

/** The duration the browser's own player reads. */
const duration = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .evaluate((el: HTMLMediaElement) => (Number.isFinite(el.duration) ? el.duration : 0));

/** Seeks the player and waits for it to get there. */
async function seek(page: Page, testId: string, seconds: number) {
  await page.getByTestId(testId).evaluate(
    (el: HTMLMediaElement, s) =>
      new Promise<void>(resolve => {
        el.addEventListener('seeked', () => resolve(), { once: true });
        el.currentTime = s;
      }),
    seconds,
  );
}

test('tops and tails a WAV from the player with [ and ]', async ({ page }) => {
  await dropBytes(page, 'tone.wav', 'audio/wav', wav({ seconds: 4 }));
  await expect(page.locator('[data-kind=audio]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('trim-strip')).toBeVisible();

  await seek(page, 'media-audio', 1);
  await page.getByTestId('trim-strip').click({ position: { x: 1, y: 1 } }); // focus off inputs
  await seek(page, 'media-audio', 1);
  await page.keyboard.press('[');
  await expect(trimForm(page).getByLabel('Trim start')).toHaveValue('0:01');
  await seek(page, 'media-audio', 3.5);
  await page.keyboard.press(']');
  await expect(trimForm(page).getByLabel('Trim end')).toHaveValue('0:03.5');
  await expect(page.getByTestId('trim-length')).toHaveText('0:02.5 kept');

  await trimForm(page).getByRole('button', { name: 'Trim' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 30_000 });
  await expect(result(page)).toContainText('tone (0:01–0:03.5).wav');
  await expect(derivedFrom(page)).toHaveText(/› Trim 0:01 → 0:03\.5$/);
  await expect.poll(() => duration(page, 'media-audio')).toBeCloseTo(2.5, 1);
});

test('trims a video with the Trim action, fast and exact', async ({ page }) => {
  await dropBytes(page, 'clip.mp4', 'video/mp4', fixture('clip.mp4'));
  await expect(page.locator('[data-kind=video]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('trim-bar')).toBeVisible();

  await trimForm(page).getByLabel('Trim start').fill('0.5');
  await trimForm(page).getByRole('button', { name: 'Trim' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 30_000 });
  await expect(result(page)).toContainText('clip (0:00.5–0:01).mp4');
  await expect(result(page).locator('[data-kind=video]')).toHaveAttribute('aria-pressed', 'true');
  // MP4 keeps the frames from the keyframe on before zero, so it still plays for 0.5 s
  await expect.poll(() => duration(page, 'media-video')).toBeCloseTo(0.5, 1);

  // The same from the sidebar, exact
  const original = page.getByTestId('capture').last();
  await original.getByRole('button', { name: 'Expand' }).click();
  await original.locator('[data-kind=video]').click();
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Trim' }).click();
  const form = pane.getByRole('form', { name: 'Trim settings' });
  await form.getByRole('textbox', { name: /^Start/ }).fill('0.5');
  await form.getByRole('combobox', { name: /^Cut/ }).selectOption('exact');
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(3, { timeout: 60_000 });
  await expect(derivedFrom(page)).toHaveText(/› Trim 0\.5 → end, exact$/);
  await expect.poll(() => duration(page, 'media-video')).toBeCloseTo(0.5, 1);
});

test('reports a bad range without running', async ({ page }) => {
  await dropBytes(page, 'tone.wav', 'audio/wav', wav({ seconds: 2 }));
  await expect(page.getByTestId('trim-bar')).toBeVisible();
  await trimForm(page).getByLabel('Trim start').fill('1.5');
  await trimForm(page).getByLabel('Trim end').fill('1');
  await trimForm(page).getByRole('button', { name: 'Trim' }).click();
  await expect(page.getByRole('alert')).toHaveText('The end must be after the start');
  await expect(page.getByTestId('capture')).toHaveCount(1);
});
