import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { wav } from '../fixtures/media';
import { actionsPane, dropBytes, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Tiny files made with FFmpeg: 2 s of Opus in Ogg, 1 s of FLAC, 1 s of H.264 + AAC in MP4. */
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/audio/${name}`, import.meta.url)));

const derivedFrom = (page: Page) => page.getByTestId('capture').first().getByTestId('derived-from');
const result = (page: Page) => page.getByTestId('capture').first();

async function convert(page: Page, format?: string) {
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Convert audio' }).click();
  const form = pane.getByRole('form', { name: 'Convert audio settings' });
  await expect(form.getByLabel('Format')).toHaveValue('mp3');
  await expect(form.getByLabel('Bitrate')).toHaveValue('192');
  if (format) await form.getByLabel('Format').selectOption(format);
  await form.getByRole('button', { name: 'Run' }).click();
}

/** The duration the browser's own player reads from the selected audio. */
const playerDuration = (page: Page) =>
  page.getByTestId('media-audio').evaluate((el: HTMLAudioElement) => el.duration);

test('converts Ogg Opus to MP3 with the LAME encoder module', async ({ page }) => {
  await dropBytes(page, 'tone.ogg', 'audio/ogg', fixture('tone.ogg'));
  await expect(page.locator('[data-kind=audio]')).toHaveAttribute('aria-pressed', 'true');

  await convert(page);
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 30_000 });
  await expect(derivedFrom(page)).toHaveText(/› Convert to MP3 \(192 kbps\)$/);
  await expect(result(page)).toContainText('tone.mp3');
  await expect(result(page).locator('[data-kind=audio]')).toHaveText(/^MP3 · 0:02/);
  await expect(stat(page, 'MIME')).toHaveText('audio/mpeg');
  await expect(stat(page, 'Sample rate')).toHaveText('48,000 Hz');
  // Tags survive the conversion
  await expect(stat(page, 'Title')).toHaveText('Test Tone');
  await expect.poll(() => playerDuration(page)).toBeGreaterThan(1.9);
  expect(await playerDuration(page)).toBeLessThan(2.2);
});

test('converts WAV to M4A (AAC), with the AAC encoder module where WebCodecs has none', async ({
  page,
}) => {
  const native = await page.evaluate(async () => {
    const config = { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 1, bitrate: 192000 };
    return (await AudioEncoder.isConfigSupported(config)).supported === true;
  });
  test.info().annotations.push({
    type: 'aac',
    description: native ? 'WebCodecs encoded AAC' : 'the aacencoder module encoded AAC',
  });

  await dropBytes(page, 'tone.wav', 'audio/wav', wav({ seconds: 2, rate: 44100 }));
  await expect(page.locator('[data-kind=audio]')).toHaveAttribute('aria-pressed', 'true');

  await convert(page, 'm4a');
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 30_000 });
  await expect(derivedFrom(page)).toHaveText(/› Convert to M4A \(192 kbps\)$/);
  await expect(result(page)).toContainText('tone.m4a');
  await expect(result(page).locator('[data-kind=audio]')).toHaveText(/^M4A · 0:02/);
  await expect(stat(page, 'Codecs')).toContainText('AAC');
});

test('FLAC to FLAC copies the stream instead of re-encoding', async ({ page }) => {
  await dropBytes(page, 'tone.flac', 'audio/flac', fixture('tone.flac'));
  await expect(page.locator('[data-kind=audio]')).toHaveAttribute('aria-pressed', 'true');

  await convert(page, 'flac');
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 30_000 });
  await expect(derivedFrom(page)).toHaveText(/› Convert to FLAC · copied, not re-encoded$/);
  await expect(result(page).locator('[data-kind=audio]')).toHaveText(/^FLAC · 0:01/);
  await expect(stat(page, 'Sample rate')).toHaveText('16,000 Hz');
});

test("extracts an MP4's AAC track into an M4A without re-encoding", async ({ page }) => {
  await dropBytes(page, 'clip.mp4', 'video/mp4', fixture('clip.mp4'));
  await expect(page.locator('[data-kind=video]')).toHaveAttribute('aria-pressed', 'true');
  // Video only: Convert audio is for audio files
  await expect(actionsPane(page).getByRole('button', { name: 'Convert audio' })).toHaveCount(0);

  await actionsPane(page).getByRole('button', { name: 'Extract audio track' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 30_000 });
  await expect(derivedFrom(page)).toHaveText(/› Extract audio track$/);
  await expect(result(page)).toContainText('clip (audio).m4a');
  const chip = result(page).locator('[data-kind=audio]');
  await expect(chip).toHaveText(/^M4A · 0:01/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(stat(page, 'Codecs')).toContainText('AAC');
  await expect(stat(page, 'Sample rate')).toHaveText('44,100 Hz');
});

test('a conversion can be cancelled', async ({ page }) => {
  // Long enough that LAME is still busy when Cancel is pressed
  await page.evaluate(() => {
    const rate = 44100;
    const frames = rate * 300;
    const dv = new DataView(new ArrayBuffer(44 + frames * 2));
    const ascii = (at: number, s: string) =>
      [...s].forEach((ch, i) => dv.setUint8(at + i, ch.charCodeAt(0)));
    ascii(0, 'RIFF');
    dv.setUint32(4, 36 + frames * 2, true);
    ascii(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    ascii(36, 'data');
    dv.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++)
      dv.setInt16(44 + i * 2, Math.round(1000 * Math.sin((2 * Math.PI * 440 * i) / rate)), true);
    const dt = new DataTransfer();
    dt.items.add(new File([dv.buffer], 'long.wav', { type: 'audio/wav' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await expect(page.locator('[data-kind=audio]')).toHaveAttribute('aria-pressed', 'true');

  await convert(page);
  const bar = actionsPane(page).getByRole('progressbar', { name: 'Convert audio progress' });
  await expect(bar).toHaveAttribute('aria-valuetext', /^Encoding · \d+%$/);
  await actionsPane(page).getByRole('button', { name: 'Cancel Convert audio' }).click();
  await expect(bar).toHaveCount(0);
  // No result and no failure notice
  await page.waitForTimeout(500);
  await expect(page.getByTestId('capture')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
});
